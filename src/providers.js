// OCR providers — each takes a base64 PNG and returns { text, readingText, translation }.
//
// Adding a new provider: implement ocrFoo(base64Png, settings, priorBubbles),
// add it to PROVIDERS (set supportsFurigana: true if it uses the LLM instruction),
// and add models to MODELS.

// Cloud providers use this instruction.
// Response format — a single JSON object:
//   {"text":"...","reading":"...","translation":"..."}
const OCR_INSTRUCTION =
  'You are a manga OCR and translation tool. For this manga panel image:\n' +
  '1. Extract ALL Japanese text visible in the image exactly as written. Do not skip any text.\n' +
  '2. Write the complete hiragana reading: convert every kanji to its hiragana reading; ' +
  'leave hiragana, katakana, and punctuation unchanged.\n' +
  '3. Translate all the text into natural English.\n\n' +
  'Return ONLY a JSON object — no markdown, no code fences, no extra text:\n' +
  '{"text":"<all japanese text>","reading":"<full hiragana reading>","translation":"<english>"}\n\n' +
  'Use \\n within string values to separate multiple speech bubbles.\n' +
  'If there is no Japanese text, return: {"text":"","reading":"","translation":""}';

// Full-page instruction: asks the LLM to output bubble center positions so we can
// sort algorithmically and place ghost highlight overlays on the page.
const FULL_PAGE_INSTRUCTION =
  'You are a manga OCR and translation tool. Analyze this manga page image.\n\n' +
  'For EACH speech bubble, thought bubble, and narration box:\n' +
  '1. Estimate the bubble center position as percentages of the image dimensions.\n' +
  '   x=0 is the left edge, x=100 the right. y=0 is the top, y=100 the bottom.\n' +
  '2. Extract ALL Japanese text in that bubble exactly as written.\n' +
  '3. Write the complete hiragana reading (convert every kanji to hiragana; leave kana unchanged).\n' +
  '4. Translate to natural English.\n\n' +
  'Output ONE entry per bubble, bubbles separated by ---.\n' +
  'Each entry: a POSITION line followed by a JSON object. No markdown, no code fences:\n' +
  'POSITION: x=<number>,y=<number>\n' +
  '{"text":"<japanese>","reading":"<hiragana>","translation":"<english>"}\n' +
  '---\n\n' +
  'If there is no Japanese text, return an empty string.';

// Prepends prior bubbles as reading context when the user has enabled it.
// Capped at 10 bubbles so the prompt stays manageable.
// Pass a custom instruction to override OCR_INSTRUCTION (used for full-page mode).
function buildInstruction(priorBubbles, useContext, instructionOverride) {
  const base = instructionOverride || OCR_INSTRUCTION;
  if (!useContext || !priorBubbles.length) return base;
  const recent = priorBubbles.slice(-10);
  const history = recent.map((t, i) => `Bubble ${i + 1}:\n${t}`).join('\n\n');
  return (
    base +
    '\n\nFor context, here are the preceding speech bubbles from this page in reading order:\n\n' +
    history
  );
}

// ---------- Response parsing ----------

// Parses one bubble chunk into { text, readingText, translation, x, y }.
// Strips an optional POSITION header (full-page scan) then JSON-parses the body.
// Falls back gracefully if the LLM produces invalid JSON.
function parseAnnotated(raw) {
  let x, y, content = raw;
  const posMatch = raw.match(/^POSITION:\s*x=(\d+(?:\.\d+)?),\s*y=(\d+(?:\.\d+)?)\s*\n/i);
  if (posMatch) {
    x = parseFloat(posMatch[1]);
    y = parseFloat(posMatch[2]);
    content = raw.slice(posMatch[0].length);
  }

  // Strip markdown code fences the LLM sometimes adds despite instructions.
  content = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    const p = JSON.parse(content);
    return {
      text:        (p.text        || '').trim(),
      readingText: (p.reading     || '').trim(),
      translation: (p.translation || '').trim(),
      x, y,
    };
  } catch {
    return { text: content, readingText: content, translation: '', x, y };
  }
}

// Sorts bubbles into manga reading order: rightmost column first, top-to-bottom
// within each column, then next column to the left, and so on.
// Bubbles whose x coordinates fall within COLUMN_THRESHOLD of each other are
// treated as belonging to the same column.
function sortByMangaOrder(bubbles) {
  const positioned   = bubbles.filter((b) => b.x !== undefined && b.y !== undefined);
  const unpositioned = bubbles.filter((b) => b.x === undefined || b.y === undefined);
  if (!positioned.length) return bubbles;

  // Bubbles within 30% horizontally share a column; within 10% vertically share a row.
  const COLUMN_THRESHOLD = 30;
  const ROW_THRESHOLD    = 10;

  // Build columns by grouping bubbles that share a similar x position.
  const columns = [];
  for (const bubble of positioned) {
    const col = columns.find((c) => Math.abs(c.x - bubble.x) <= COLUMN_THRESHOLD);
    if (col) {
      col.bubbles.push(bubble);
      col.x = col.bubbles.reduce((s, b) => s + b.x, 0) / col.bubbles.length;
    } else {
      columns.push({ x: bubble.x, bubbles: [bubble] });
    }
  }

  // Sort columns right-to-left.
  columns.sort((a, b) => b.x - a.x);

  const sorted = [];
  for (const col of columns) {
    col.bubbles.sort((a, b) => {
      // Bubbles at nearly the same vertical position are on the same row.
      // Break the tie with x — rightmost first, matching manga reading direction.
      if (Math.abs(a.y - b.y) <= ROW_THRESHOLD) return b.x - a.x;
      return a.y - b.y;
    });
    sorted.push(...col.bubbles);
  }

  return [...sorted, ...unpositioned];
}

// ---------- Anthropic (Claude) ----------

async function ocrAnthropic(base64Png, { apiKey, model, useContext, customInstruction }, priorBubbles = []) {
  if (!apiKey) throw new Error('No Anthropic API key set. Add one in the popup.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for browser-origin requests (extensions count as browsers):
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: base64Png },
            },
            { type: 'text', text: buildInstruction(priorBubbles, useContext, customInstruction) },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// ---------- OpenAI (GPT-4o) ----------

async function ocrOpenAI(base64Png, { apiKey, model, useContext, customInstruction }, priorBubbles = []) {
  if (!apiKey) throw new Error('No OpenAI API key set. Add one in the popup.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildInstruction(priorBubbles, useContext, customInstruction) },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Png}` },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content || '').trim();
}

// ---------- Google (Gemini) ----------

async function ocrGemini(base64Png, { apiKey, model, useContext, customInstruction }, priorBubbles = []) {
  if (!apiKey) throw new Error('No Google API key set. Add one in the popup.');
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: buildInstruction(priorBubbles, useContext, customInstruction) },
            { inline_data: { mime_type: 'image/png', data: base64Png } },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0,
        // 2.5 Flash defaults to using "thinking" tokens. For OCR we just want
        // raw text out, so disable thinking to cut latency and cost. The field
        // is ignored by 2.0 and older models.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

// ---------- Local manga-ocr server ----------

async function ocrLocal(base64Png, { localUrl }) {
  const url = localUrl || 'http://localhost:7331/ocr';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Png }),
  });
  if (!res.ok) throw new Error(`Local OCR ${res.status}`);
  const json = await res.json();
  if (typeof json.text !== 'string') throw new Error('Malformed local response');
  return json.text;
}

// ---------- Registry + catalog ----------

export const PROVIDERS = {
  anthropic: { label: 'Claude',                  run: ocrAnthropic, supportsFurigana: true  },
  openai:    { label: 'OpenAI',                  run: ocrOpenAI,    supportsFurigana: true  },
  google:    { label: 'Gemini',                  run: ocrGemini,    supportsFurigana: true  },
  local:     { label: 'Local manga-ocr server',  run: ocrLocal,     supportsFurigana: false },
};

// Model catalog shown in the popup. Update freely; the values are passed
// straight through to the provider as the `model` field.
export const MODELS = {
  anthropic: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast, cheap — recommended)' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
    { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (max quality)' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
    { value: 'gpt-4o', label: 'GPT-4o (better quality)' },
  ],
  google: [
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (fastest, cheapest — recommended)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (better quality)' },
  ],
  local: [{ value: 'manga-ocr', label: 'manga-ocr (local server)' }],
};

// Returns { text, readingText, translation } for a single cropped bubble.
export async function runOcr(base64Png, settings, priorBubbles = []) {
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new Error(`Unknown provider: ${settings.provider}`);
  const raw = await provider.run(base64Png, settings, priorBubbles);
  if (provider.supportsFurigana) return parseAnnotated(raw);
  return { text: raw, readingText: raw, translation: '' }; // local server: no readings or translation
}

// Captures a full page and returns an ordered array of { text, readingText, translation }
// objects — one per detected speech bubble, in manga reading order (R→L, T→B).
export async function runFullPageOcr(base64Png, settings) {
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new Error(`Unknown provider: ${settings.provider}`);
  if (!provider.supportsFurigana) {
    throw new Error('Full page scan requires a cloud LLM provider. Switch from the local server to use this feature.');
  }
  const raw = await provider.run(
    base64Png,
    { ...settings, customInstruction: FULL_PAGE_INSTRUCTION },
    []
  );
  if (!raw.trim()) return [];
  const bubbles = raw
    .split(/\n?---\n?/)
    .map((chunk) => parseAnnotated(chunk.trim()))
    .filter((b) => b.text.trim());
  return sortByMangaOrder(bubbles);
}
