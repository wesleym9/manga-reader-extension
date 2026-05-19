# Manga Reader Assistant

A Chrome extension that OCRs Japanese manga text on web pages and renders it as
selectable DOM text so dictionary extensions like **Yomitan** can do hover
lookups natively.

OCR is handled by a vision LLM of your choice — **Claude**, **GPT-4o**, or
**Gemini** — so there's no model to download and no server to run. Bring your
own API key (stored locally, never leaves your browser except to the provider
you picked).

## How it works

1. Hit **Alt+M** (or click the toolbar icon → "Start selection").
2. Drag a rectangle over a manga speech bubble.
3. The extension screenshots the visible tab, crops the region, and sends it
   to your chosen LLM.
4. The recognized Japanese text appears as an overlay positioned on the bubble.
5. Hover the text with Yomitan to look up words and make Anki cards.

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

Keys live in `chrome.storage.local` and are sent only to the provider you
chose. Nothing is proxied through any third party.

### 3. (Recommended) Install Yomitan

Get it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/yomitan/likgccmbimhjbgkjambclfkhldnlhbnn).
Import a dictionary (JMdict is the standard). Yomitan picks up the OCR'd text
in our overlays automatically — they don't need to know about each other.

## Usage

- **Alt+M** — toggle selection mode (rebindable at `chrome://extensions/shortcuts`)
- Drag over a speech bubble
- **Esc** — exit selection mode
- Click **×** on an overlay to dismiss it
- Toolbar popup → **Clear overlays** to remove all

## Cost and latency (rough numbers)

Per-bubble OCR call:

| Model | Latency | Cost |
|---|---|---|
| Claude Haiku 4.5 | ~1–2s | fraction of a cent |
| Claude Sonnet 4.6 | ~1–3s | ~1¢ |
| Claude Opus 4.7 | ~2–4s | ~5¢ |
| GPT-4o mini | ~1–2s | fraction of a cent |
| GPT-4o | ~1–3s | ~1¢ |
| Gemini 2.5 Flash-Lite | ~1–2s | fraction of a cent (free tier available) |
| Gemini 2.5 Flash | ~1–3s | ~0.1¢ |

A chapter of manga (~40 bubbles you actually look up) on the cheap tier is
typically a few cents. Haiku 4.5 / GPT-4o mini / Gemini 2.5 Flash-Lite are all
recommended defaults — they handle clean speech-bubble text well. Step up to
Sonnet / GPT-4o / 2.5 Flash for stylized fonts or noisy panels.

## Privacy

- API keys live in `chrome.storage.local`. They never leave your machine
  except in the `Authorization` / `x-api-key` header of the request to the
  provider you selected.
- The image bytes you OCR are sent to that provider. Their privacy policy
  applies. Anthropic and OpenAI both offer "no training on your data" by
  default for paid API usage; Google's terms vary by tier.
- The extension makes no other network requests.

## Optional: local OCR (no API key, no cloud)

If you'd rather not use an LLM, the included Python server wraps
[manga-ocr](https://github.com/kha-white/manga-ocr) — a model fine-tuned
specifically for Japanese manga.

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

In the popup, set **Provider → Local manga-ocr server**.

First run downloads the model (~400MB). Subsequent OCRs are 200–800ms on CPU.

## Architecture

```
[ content.js ] -- selection + overlay rendering
       |
       | OCR_REGION { rect, dpr }
       v
[ background.js ] -- captureVisibleTab → crop on OffscreenCanvas
       |
       | runOcr(base64Png, settings)
       v
[ providers.js ] -- dispatch by settings.provider:
                    ├── api.anthropic.com
                    ├── api.openai.com
                    ├── generativelanguage.googleapis.com
                    └── http://localhost:7331/ocr
```

Key design choices:

- **Selectable DOM text** instead of canvas overlays, so Yomitan works
  out-of-the-box.
- **captureVisibleTab** for image data, which sidesteps cross-origin
  restrictions on the manga site's `<img>` elements.
- **Pluggable providers** — each is a single function in `providers.js`.

## Adding a new provider

Open `src/providers.js`. Add a function:

```js
async function ocrMyProvider(base64Png, { apiKey, model }) {
  // POST to your endpoint, return the recognized text as a string.
}
```

Register it in `PROVIDERS` and add models to `MODELS`. Add the provider to
the dropdown in `popup.html` and `host_permissions` in `manifest.json`.

## Roadmap

- Auto-detect speech bubbles (no drag rectangle needed)
- Background OCR all bubbles on page load (instant hover)
- "Explain this sentence" sidebar — grammar breakdown via the same LLM
- Anki card generation with the panel image attached
- Per-site adapters (MangaDex, Cubari)

## License

MIT.
