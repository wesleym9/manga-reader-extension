// Content script — runs on every page.
// Responsibilities:
//   1. Toggle a "selection mode" where the user drags a rectangle over a manga bubble
//   2. Send the selected region (image crop) to the background for OCR
//   3. Render the OCR result as a selectable-text overlay positioned over the original bubble
//      (so Yomitan can hover-look-up the words natively)

(() => {
  // Guard against double-injection on SPAs
  if (window.__mangaReaderInjected) return;
  window.__mangaReaderInjected = true;

  let selectionMode = false;
  let dragStart = null;
  let dragRect = null;
  const overlays = []; // track for cleanup

  // ---------- Selection mode UI ----------

  const banner = document.createElement('div');
  banner.className = 'mra-banner';
  banner.textContent = 'Selection mode — drag over a text bubble  •  Esc to exit';
  banner.style.display = 'none';
  document.documentElement.appendChild(banner);

  const dragBox = document.createElement('div');
  dragBox.className = 'mra-drag-box';
  dragBox.style.display = 'none';
  document.documentElement.appendChild(dragBox);

  function enterSelectionMode() {
    if (selectionMode) return;
    selectionMode = true;
    document.documentElement.classList.add('mra-selecting');
    banner.style.display = 'block';
  }

  function exitSelectionMode() {
    selectionMode = false;
    document.documentElement.classList.remove('mra-selecting');
    banner.style.display = 'none';
    dragBox.style.display = 'none';
    dragStart = null;
    dragRect = null;
  }

  // ---------- Drag handling ----------

  document.addEventListener('mousedown', (e) => {
    if (!selectionMode) return;
    // Don't start a drag if clicking on our own overlay
    if (e.target.closest('.mra-overlay, .mra-banner')) return;
    e.preventDefault();
    e.stopPropagation();
    dragStart = { x: e.clientX, y: e.clientY };
    dragBox.style.left = `${e.clientX}px`;
    dragBox.style.top = `${e.clientY}px`;
    dragBox.style.width = '0px';
    dragBox.style.height = '0px';
    dragBox.style.display = 'block';
  }, true);

  document.addEventListener('mousemove', (e) => {
    if (!selectionMode || !dragStart) return;
    const x = Math.min(dragStart.x, e.clientX);
    const y = Math.min(dragStart.y, e.clientY);
    const w = Math.abs(e.clientX - dragStart.x);
    const h = Math.abs(e.clientY - dragStart.y);
    dragRect = { x, y, w, h };
    dragBox.style.left = `${x}px`;
    dragBox.style.top = `${y}px`;
    dragBox.style.width = `${w}px`;
    dragBox.style.height = `${h}px`;
  }, true);

  document.addEventListener('mouseup', async (e) => {
    if (!selectionMode || !dragStart) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = dragRect;
    dragStart = null;
    dragRect = null;
    dragBox.style.display = 'none';

    if (!rect || rect.w < 8 || rect.h < 8) return; // ignore stray clicks

    await handleSelection(rect);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectionMode) exitSelectionMode();
  });

  // ---------- Capture + OCR pipeline ----------

  async function handleSelection(rect) {
    // Show a loading overlay immediately so the user gets feedback
    const loading = renderOverlay(rect, '…', { loading: true });

    try {
      // Ask the background to capture the visible tab and crop our region.
      // We send viewport coords; background handles devicePixelRatio.
      const resp = await chrome.runtime.sendMessage({
        type: 'OCR_REGION',
        rect,
        dpr: window.devicePixelRatio || 1,
      });

      loading.remove();

      if (resp && resp.ok) {
        renderOverlay(rect, resp.text || '(no text detected)', { loading: false });
      } else {
        renderOverlay(rect, `OCR error: ${resp?.error || 'unknown'}`, {
          loading: false,
          error: true,
        });
      }
    } catch (err) {
      loading.remove();
      renderOverlay(rect, `Error: ${err.message}`, { loading: false, error: true });
    }
  }

  // ---------- Overlay rendering ----------
  // The overlay is a fixed-position div containing the OCR'd text as REAL DOM text.
  // Yomitan and other dictionary extensions will pick it up natively on hover.

  function renderOverlay(rect, text, { loading = false, error = false } = {}) {
    const el = document.createElement('div');
    el.className = 'mra-overlay';
    if (loading) el.classList.add('mra-overlay-loading');
    if (error) el.classList.add('mra-overlay-error');

    el.style.left = `${rect.x + window.scrollX}px`;
    el.style.top = `${rect.y + window.scrollY}px`;
    el.style.width = `${rect.w}px`;
    el.style.minHeight = `${rect.h}px`;

    const textEl = document.createElement('div');
    textEl.className = 'mra-overlay-text';
    textEl.lang = 'ja';
    textEl.textContent = text;
    el.appendChild(textEl);

    const close = document.createElement('button');
    close.className = 'mra-overlay-close';
    close.textContent = '×';
    close.title = 'Dismiss';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      el.remove();
    });
    el.appendChild(close);

    // Note: positioned in document coordinates (with scrollX/Y), so it sticks
    // to the page content rather than the viewport.
    document.body.appendChild(el);
    overlays.push(el);
    return el;
  }

  // ---------- Messages from popup / background ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'TOGGLE_SELECTION') {
      if (selectionMode) exitSelectionMode();
      else enterSelectionMode();
      sendResponse({ ok: true, selectionMode });
      return true;
    }
    if (msg.type === 'CLEAR_OVERLAYS') {
      overlays.splice(0).forEach((o) => o.remove());
      sendResponse({ ok: true });
      return true;
    }
  });
})();
