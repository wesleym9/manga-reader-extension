# Manga Reader Assistant

A Chrome extension that OCRs Japanese manga text on web pages, renders it as selectable
DOM text, and displays a session log with furigana readings, original kanji, and English
translations.

OCR and translation are handled by a vision LLM of your choice — **Claude**, **GPT-4o**, or
**Gemini** — so there's no model to download and no server to run. Bring your own API key
(stored locally, never leaves your browser except to the provider you picked).

## How it works

1. Hit **Alt+M** (or click the toolbar icon → "Start selection").
2. Drag a rectangle over a manga speech bubble.
3. The extension screenshots the visible tab, crops the region, and sends it to your chosen LLM.
4. The recognized Japanese text appears as a selectable overlay positioned on the bubble.
5. A **Session Log** panel opens automatically showing the hiragana reading, original kanji,
   and English translation for every bubble you've scanned.
6. The overlays are selectable DOM text — compatible with browser dictionary extensions.

## Setup

### 1. Load the extension

1. Download / clone this folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this directory.
5. Pin the extension to the toolbar.

### 2. Add an API key

Click the toolbar icon. In the popup:

- **Provider** — Claude, GPT-4o, Gemini, or "Local manga-ocr server"
- **Model** — defaults to the cheapest/fastest in that family
- **API key** — paste it in and hit **Save**

Where to get keys:
- **Anthropic (Claude):** https://console.anthropic.com
- **OpenAI (GPT-4o):** https://platform.openai.com
- **Google (Gemini):** https://aistudio.google.com

Keys live in `chrome.storage.local` and are sent only to the provider you chose. Nothing
is proxied through any third party.

### 3. (Optional) Install a browser dictionary extension

The OCR overlays render as real DOM text nodes, so any hover-lookup dictionary extension
will work with them automatically without any special integration.

## Usage

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Alt+M** | Toggle single-bubble selection mode |
| **Alt+F** | Toggle full-page area scan mode |
| **Alt+C** | Clear all overlays from the current page |
| **Esc** | Exit the current selection mode |

All shortcuts are rebindable at `chrome://extensions/shortcuts`.

### Single-bubble OCR (Alt+M)

Enters a selection mode where you drag a rectangle over any speech bubble. The extension
crops that region, sends it to the LLM, and places a selectable text overlay on top of the
bubble. The overlay is clipped to your selection height; if the text overflows, a **[...]**
indicator appears — hover the overlay to expand it.

Click **×** on an overlay to dismiss it individually, or use **Alt+C** / "Clear overlays"
in the popup to remove all at once.

Hovering a **linked log entry** highlights the corresponding bubble overlay on the page with
a blue tint and border so you can see exactly which bubble the log entry refers to.

### Full-page area scan (Alt+F)

Enters a selection mode where you drag a rectangle over the entire manga page (or any
portion of it). The extension sends that whole region to the LLM, which identifies every
speech bubble, reads them in **manga reading order** (right column top-to-bottom, then left
column top-to-bottom), and adds each bubble as a separate log entry.

Use this to get a complete translation of a page in one action. Because the image can
contain many bubbles, this call uses significantly more tokens than single-bubble mode.
Not available with the local server.

### Session log

After the first bubble is scanned, the **Session Log** panel slides in from the right. Each
entry shows three layers:

```
#1                              [▶]
せいとかいでーす                ← hiragana reading (grey, smaller)
生徒会でーす                    ← original kanji text
Excuse me, I'm from the        ← English translation (italic)
student council.
```

- Click **▶** to hear the Japanese text read aloud. Click **■** to stop.
- Hover a log entry linked to a page overlay (single-bubble entries) to highlight that
  bubble on the page.
- **Clear** in the panel header clears the log; overlays on the page are unaffected.
- The log resets on page refresh. Use **Log (N)** in the bottom-right corner to open or
  close the panel at any time.

### Context-aware OCR

Enable **Use session log as context** in the popup to send the prior session log to the
LLM with each new single-bubble request. This improves pronoun resolution, speaker
tracking, and reading-order coherence at the cost of slightly more tokens per call. Not
available with the local server.

## Read-aloud (text-to-speech)

The speaker button (▶) uses the browser's built-in speech synthesis — no API key required.
For natural-sounding Japanese pronunciation you need a Japanese voice installed on your OS.

**Windows**

A Japanese voice is not installed by default. To add one:

1. Open **Settings → Time & Language → Speech**.
2. Under *Manage voices*, click **Add voices**.
3. Search for **日本語** and install it.
4. Restart Chrome.

**macOS**

A Japanese voice (Kyoko or Otoya) is usually pre-installed. If it's missing:

1. Open **System Settings → Accessibility → Spoken Content**.
2. Click the **System Voice** dropdown → **Manage Voices…**
3. Find **Japanese** and click the download arrow.

**Linux**

Install `espeak-ng` with Japanese support or `festival` with a Japanese voice package. The
exact package name varies by distro (e.g. `espeak-ng-data` on Debian-based systems).

## Cost and latency (rough numbers)

**Single-bubble OCR** (one bubble, all three output fields):

| Model | Latency | Cost |
|---|---|---|
| Claude Haiku 4.5 | ~1–2s | fraction of a cent |
| Claude Sonnet 4.6 | ~1–3s | ~1¢ |
| Claude Opus 4.7 | ~2–4s | ~5¢ |
| GPT-4o mini | ~1–2s | fraction of a cent |
| GPT-4o | ~1–3s | ~1¢ |
| Gemini 2.5 Flash-Lite | ~1–2s | fraction of a cent (free tier available) |
| Gemini 2.5 Flash | ~1–3s | ~0.1¢ |

**Full-page area scan** uses roughly 5–15× more tokens depending on how many bubbles the
selected area contains. A dense page with 10+ bubbles on Haiku 4.5 is typically 2–5¢.

Haiku 4.5 / GPT-4o mini / Gemini 2.5 Flash-Lite are recommended defaults for everyday
reading. Step up to Sonnet / GPT-4o / 2.5 Flash for stylized fonts or noisy panels.

## Privacy

- API keys live in `chrome.storage.local`. They never leave your machine except in the
  `Authorization` / `x-api-key` header of the request to the provider you selected.
- The image bytes you OCR are sent to that provider. Their privacy policy applies.
  Anthropic and OpenAI both offer "no training on your data" by default for paid API usage;
  Google's terms vary by tier.
- The extension makes no other network requests.

## Optional: local OCR (no API key, no cloud)

If you'd rather not use an LLM, the included Python server wraps
[manga-ocr](https://github.com/kha-white/manga-ocr) — a model fine-tuned specifically for
Japanese manga.

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

In the popup, set **Provider → Local manga-ocr server**.

First run downloads the model (~400MB). Subsequent OCRs are 200–800ms on CPU.

The local server returns plain text only — no hiragana reading, no English translation, and
the full-page scan and context features are unavailable.

## Architecture

```
[ content.js ]   selection UI · overlays · session log panel
      |
      |  OCR_REGION { rect, dpr, priorBubbles }
      |  FULL_PAGE_REGION { rect, dpr }
      |  TOGGLE_SELECTION / TOGGLE_FULLPAGE_SELECTION / CLEAR_OVERLAYS / PING
      v
[ background.js ]  service worker — captureVisibleTab → crop → dispatch
      |
      |  runOcr(base64, settings, priorBubbles)    → { text, readingText, translation }
      |  runFullPageOcr(base64, settings)           → [{ text, readingText, translation, x, y }, …]
      v
[ providers.js ]  pluggable backends + response parsing:
                  ├── ocrAnthropic  → api.anthropic.com
                  ├── ocrOpenAI     → api.openai.com
                  ├── ocrGemini     → generativelanguage.googleapis.com
                  └── ocrLocal      → http://localhost:7331/ocr
```

Key design choices:

- **Selectable DOM text** instead of canvas overlays, so browser dictionary extensions work without any special integration.
- **captureVisibleTab** for image data, which sidesteps cross-origin restrictions on the
  manga site's `<img>` elements.
- **JSON response format** — providers return `{"text":"…","reading":"…","translation":"…"}`
  so all three fields arrive in a single LLM call with no ambiguous delimiters.
- **Full-page scan uses coordinate-based sort** — the LLM reports each bubble's center
  position (`POSITION: x=…,y=…`), and `sortByMangaOrder()` in `providers.js` groups
  bubbles into columns and sorts right-to-left, top-to-bottom.
- **`translate="no"`** on the session log panel and overlays prevents Chrome's built-in
  page translation from overwriting the Japanese text.

## Adding a new provider

Open `src/providers.js`. Add a function:

```js
async function ocrMyProvider(base64Png, { apiKey, model, useContext, customInstruction }, priorBubbles = []) {
  const instruction = buildInstruction(priorBubbles, useContext, customInstruction);
  // POST to your endpoint using `instruction` as the prompt.
  // Return the raw LLM response string — parseAnnotated() handles the rest.
}
```

Register it in `PROVIDERS` (set `supportsFurigana: true` if it uses the LLM instruction)
and add models to `MODELS`. Add the provider to the dropdown in `popup.html`,
`host_permissions` in `manifest.json`, and the key mapping in `popup.js`.

## Roadmap

- Auto-detect speech bubbles (no drag rectangle needed)
- "Explain this sentence" sidebar — grammar breakdown via the same LLM
- Anki card generation with the panel image attached
- Per-site adapters (MangaDex, Cubari)

## License

MIT.
