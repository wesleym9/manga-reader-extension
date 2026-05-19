// OCR providers — each takes a base64 PNG and returns the recognized text.
//
// Adding a new provider: implement runOcr(base64Png, settings) and add it
// to the PROVIDERS map at the bottom.

const OCR_INSTRUCTION =
  'Extract the Japanese text from this manga panel. ' +
  'Return ONLY the text exactly as written, preserving original line breaks. ' +
  'No translation, no romaji, no commentary, no quotation marks. ' +
  'If multiple speech bubbles are present, separate them with a single blank line. ' +
  'If there is no Japanese text, return an empty string.';

// ---------- Anthropic (Claude) ----------

async function ocrAnthropic(base64Png, { apiKey, model }) {
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
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: base64Png },
            },
            { type: 'text', text: OCR_INSTRUCTION },
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
  const text = (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text;
}

// ---------- OpenAI (GPT-4o) ----------

async function ocrOpenAI(base64Png, { apiKey, model }) {
  if (!apiKey) throw new Error('No OpenAI API key set. Add one in the popup.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_INSTRUCTION },
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

async function ocrGemini(base64Png, { apiKey, model }) {
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
            { text: OCR_INSTRUCTION },
            { inline_data: { mime_type: 'image/png', data: base64Png } },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1024,
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

// ---------- Local manga-ocr server (legacy) ----------

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
  anthropic: { label: 'Claude', run: ocrAnthropic },
  openai: { label: 'OpenAI', run: ocrOpenAI },
  google: { label: 'Gemini', run: ocrGemini },
  local: { label: 'Local manga-ocr server', run: ocrLocal },
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

export async function runOcr(base64Png, settings) {
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new Error(`Unknown provider: ${settings.provider}`);
  return provider.run(base64Png, settings);
}
