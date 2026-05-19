# Manga Reader Assistant — project notes for Claude Code

A Chrome extension (MV3) that OCRs Japanese manga text on web pages and renders
selectable DOM text so Yomitan can do hover lookups. OCR is pluggable across
Anthropic, OpenAI, Google, and a local manga-ocr server.

## Architecture

```
[ src/content.js ]   selection UI, drag-rectangle, overlay rendering
        |
        |  chrome.runtime.sendMessage({ type: 'OCR_REGION', rect, dpr })
        v
[ src/background.js ]  service worker — captureVisibleTab → crop → dispatch
        |
        |  runOcr(base64Png, settings)
        v
[ src/providers.js ]  pluggable backends:
                      ├── ocrAnthropic  → api.anthropic.com
                      ├── ocrOpenAI     → api.openai.com
                      ├── ocrGemini     → generativelanguage.googleapis.com
                      └── ocrLocal      → http://localhost:7331/ocr
```

`src/popup.{html,js,css}` is the toolbar UI: provider/model selection, API key
storage, and the "start selection" / "clear overlays" actions.

`backend/server.py` is an optional local OCR server wrapping
[manga-ocr](https://github.com/kha-white/manga-ocr) for users who don't want
to use a cloud LLM.

## Key design decisions (don't break these without discussion)

- **Overlays render real DOM text, not canvas.** That's what makes Yomitan work
  without integration. If you change overlay rendering, preserve selectable
  text with `user-select: text` and `lang="ja"`.
- **captureVisibleTab is the image source**, not the `<img>` element. This
  sidesteps cross-origin restrictions on manga site images. Don't try to fetch
  the source `<img>` directly unless you've thought through CORS.
- **Service workers have no DOM.** Cropping in `background.js` uses
  `OffscreenCanvas`. Don't reach for `document` or `Image` there.
- **devicePixelRatio matters.** `captureVisibleTab` returns pixels at device
  resolution; the content script sends CSS coords. Multiply by `dpr` when
  cropping or you'll get the wrong region on retina displays.
- **API keys live in `chrome.storage.local`**, not in code or env vars. Per-
  provider keys are kept separately so users can switch without re-pasting.

## File map

```
manifest.json              MV3 manifest, host permissions, keyboard shortcut
CLAUDE.md                  this file — read first
README.md                  user-facing docs
LICENSE                    MIT
.gitignore                 venvs, OS junk, build artifacts
.gitattributes             pin LF line endings (we develop on Windows + *nix)
src/
  content.js               injected into every page; selection + overlays
  background.js            service worker (type: module); capture + dispatch
  providers.js             OCR provider implementations + MODELS catalog
  popup.html/css/js        toolbar popup; module script
  overlay.css              selection mode + overlay styles
backend/
  server.py                optional local manga-ocr HTTP server (port 7331)
  requirements.txt
icons/                     16/48/128 PNG placeholders
```

## Platform notes

This project is developed on Windows. A few things to keep in mind:

- All source files use **LF line endings**, enforced by `.gitattributes`. If
  your editor inserts CRLF, fix it before committing — Chrome doesn't care
  but diffs become unreadable.
- Use **forward slashes** in paths inside source files (`src/content.js`,
  not `src\content.js`). Chrome's manifest and JS imports are URL-style.
- The optional Python backend works on Windows but uses `127.0.0.1:7331` —
  make sure your firewall allows local loopback (it does by default).

## Conventions

- Vanilla JS, no build step. No bundler, no TypeScript, no framework. Keep it
  that way — the extension is small enough that any tooling is overhead.
- ES modules in the popup and background (declared `type: module` in manifest).
  The content script is a classic script because MV3 content scripts can't be
  modules without dynamic import gymnastics.
- Message passing uses string `type` fields: `OCR_REGION`, `TOGGLE_SELECTION`,
  `CLEAR_OVERLAYS`, `PING`. Add to the registry in both `content.js` and
  `background.js`/`popup.js` when introducing new ones.
- All overlay CSS classes are prefixed `mra-` (manga reader assistant) to
  avoid colliding with manga-site styles.

## Testing the extension manually

There's no test suite yet (would be nice eventually). Manual loop:

1. `chrome://extensions` → enable Developer mode → "Load unpacked" → select
   this directory.
2. After editing files, click the refresh button on the extension card.
3. **Refresh any open manga tabs** — content scripts from the old version are
   orphaned after reload and will throw "Extension context invalidated."
4. Try a real manga site (MangaDex with a Japanese chapter works well). Hit
   Alt+M, drag over a bubble.

To test the local backend:
```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && python server.py
```

## Lint / syntax checks

No linter configured. Cheap syntax check before testing in Chrome:
```bash
for f in src/*.js; do node --check "$f"; done
python3 -c "import json; json.load(open('manifest.json'))"
```

## Known issues & roadmap

- **"Extension context invalidated"** appears after dev-time reloads. We
  should detect this in `content.js` and show a friendly "refresh the page"
  message instead of the raw error string.
- **No auto bubble detection** — users must drag every region. Adding a small
  detector (comic-text-detector is the open-source standard) is the biggest
  UX win available. Would need to run server-side or via ONNX in the
  background.
- **No batch / full-page OCR** — single bubble per call. Sending the whole
  viewport to a vision LLM and asking for bounding boxes is a possible v2.
- **No "explain this sentence" grammar layer** — the killer feature that
  justifies calling this an "agent" rather than just an OCR tool. Would hit
  the same LLM the user already configured.

## What NOT to do

- Don't add a build step. No webpack, no vite, no TypeScript.
- Don't bundle a model into the extension. The whole point of the LLM
  providers is to avoid shipping ML weights.
- Don't proxy API calls through a third-party server. Keys go directly from
  the user's browser to the chosen provider.
- Don't add analytics or telemetry.
