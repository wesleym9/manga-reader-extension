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
  let isFullPageMode = false; // true when Alt+F / "Scan page area" selection is active
  let dragStart = null;
  let dragRect = null;
  const overlays = []; // track for cleanup
  const sessionLog = []; // OCR results in order for the log panel

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

  // ---------- Session log panel ----------

  const logPanel = document.createElement('div');
  logPanel.className = 'mra-log-panel';
  logPanel.setAttribute('translate', 'no');

  const logHeader = document.createElement('div');
  logHeader.className = 'mra-log-header';
  const logTitle = document.createElement('span');
  logTitle.textContent = 'Session Log';
  logHeader.appendChild(logTitle);
  const logClearBtn = document.createElement('button');
  logClearBtn.className = 'mra-log-clear';
  logClearBtn.textContent = 'Clear';
  logClearBtn.addEventListener('click', clearLog);
  logHeader.appendChild(logClearBtn);
  const logCloseBtn = document.createElement('button');
  logCloseBtn.className = 'mra-log-close';
  logCloseBtn.textContent = '×';
  logCloseBtn.title = 'Close log';
  logCloseBtn.addEventListener('click', () => toggleLog(false));
  logHeader.appendChild(logCloseBtn);
  logPanel.appendChild(logHeader);

  const logEntries = document.createElement('div');
  logEntries.className = 'mra-log-entries';
  const logEmpty = document.createElement('p');
  logEmpty.className = 'mra-log-empty';
  logEmpty.textContent = 'No bubbles OCR\'d yet this session.';
  logEntries.appendChild(logEmpty);
  logPanel.appendChild(logEntries);
  document.documentElement.appendChild(logPanel);

  const logToggle = document.createElement('button');
  logToggle.className = 'mra-log-toggle';
  logToggle.style.display = 'none';
  logToggle.addEventListener('click', () => toggleLog());
  document.documentElement.appendChild(logToggle);

  function enterSelectionMode(fullPage = false) {
    if (selectionMode) exitSelectionMode();
    selectionMode = true;
    isFullPageMode = fullPage;
    document.documentElement.classList.add('mra-selecting');
    banner.textContent = fullPage
      ? 'Page scan — drag over the manga page  •  Esc to exit'
      : 'Selection mode — drag over a text bubble  •  Esc to exit';
    banner.style.display = 'block';
    updateLogToggle();
  }

  function exitSelectionMode() {
    selectionMode = false;
    isFullPageMode = false;
    document.documentElement.classList.remove('mra-selecting');
    banner.style.display = 'none';
    dragBox.style.display = 'none';
    dragStart = null;
    dragRect = null;
    updateLogToggle();
  }

  // ---------- Log panel helpers ----------

  function toggleLog(force) {
    const open = force !== undefined ? force : !logPanel.classList.contains('mra-log-open');
    logPanel.classList.toggle('mra-log-open', open);
    updateLogToggle();
  }

  function updateLogToggle() {
    const isOpen = logPanel.classList.contains('mra-log-open');
    // Show the toggle only when the panel is closed and there's a reason to open it.
    logToggle.style.display = !isOpen && (sessionLog.length > 0 || selectionMode) ? 'block' : 'none';
    logToggle.textContent = `Log (${sessionLog.length})`;
  }

  function addToLog(text, readingText, translation, linkedOverlay = null) {
    sessionLog.push(text);
    if (sessionLog.length === 1) {
      logEmpty.style.display = 'none';
      toggleLog(true); // auto-open on first result of the session
    }

    const entry = document.createElement('div');
    entry.className = 'mra-log-entry';

    // Header row: entry number + speak button
    const entryHeader = document.createElement('div');
    entryHeader.className = 'mra-log-entry-header';

    const num = document.createElement('div');
    num.className = 'mra-log-num';
    num.textContent = `#${sessionLog.length}`;
    entryHeader.appendChild(num);

    const speakBtn = document.createElement('button');
    speakBtn.className = 'mra-log-speak';
    speakBtn.textContent = '▶'; // ▶
    speakBtn.title = 'Read aloud';
    speakBtn.addEventListener('click', () => speakLogEntry(text, speakBtn));
    entryHeader.appendChild(speakBtn);

    entry.appendChild(entryHeader);

    // Reading line (hiragana) — only shown when it contains Japanese and differs from plain text.
    // The Japanese check prevents double-English when the LLM operates on non-Japanese panels.
    const hasJapanese = /[぀-ヿ一-鿿]/.test(readingText);
    if (readingText && readingText !== text && hasJapanese) {
      const reading = document.createElement('div');
      reading.className = 'mra-log-reading';
      reading.lang = 'ja';
      reading.textContent = readingText;
      entry.appendChild(reading);
    }

    // Original text (kanji)
    const txt = document.createElement('div');
    txt.className = 'mra-log-text';
    txt.lang = 'ja';
    txt.textContent = text;
    entry.appendChild(txt);

    // English translation line
    if (translation) {
      const trans = document.createElement('div');
      trans.className = 'mra-log-translation';
      trans.textContent = translation;
      entry.appendChild(trans);
    }

    // Highlight the corresponding page overlay on hover when one exists.
    if (linkedOverlay) {
      entry.classList.add('mra-log-linked');
      entry.addEventListener('mouseenter', () => {
        if (linkedOverlay.isConnected) linkedOverlay.classList.add('mra-overlay-highlighted');
      });
      entry.addEventListener('mouseleave', () => {
        linkedOverlay.classList.remove('mra-overlay-highlighted');
      });
    }

    logEntries.appendChild(entry);
    logEntries.scrollTop = logEntries.scrollHeight;
    updateLogToggle();
  }

  function speakLogEntry(text, btn) {
    if (!('speechSynthesis' in window)) return;

    // Clicking an active button stops playback.
    if (btn.classList.contains('mra-speaking')) {
      window.speechSynthesis.cancel();
      return;
    }

    window.speechSynthesis.cancel();

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'ja-JP';
    utt.rate = 0.9;

    // Prefer an explicit Japanese voice if one is installed.
    const voices = window.speechSynthesis.getVoices();
    const jpVoice = voices.find((v) => v.lang === 'ja-JP') || voices.find((v) => v.lang.startsWith('ja'));
    if (jpVoice) utt.voice = jpVoice;

    // Mark the active button; clear it when done or on error.
    document.querySelectorAll('.mra-log-speak.mra-speaking').forEach((b) => {
      b.classList.remove('mra-speaking');
      b.textContent = '▶';
    });
    btn.classList.add('mra-speaking');
    btn.textContent = '■';
    const reset = () => { btn.classList.remove('mra-speaking'); btn.textContent = '▶'; };
    utt.onend = reset;
    utt.onerror = reset;

    window.speechSynthesis.speak(utt);
  }

  function clearLog() {
    sessionLog.length = 0;
    logEntries.innerHTML = '';
    logEntries.appendChild(logEmpty);
    logEmpty.style.display = '';
    updateLogToggle();
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

    if (isFullPageMode) {
      exitSelectionMode();
      await handleFullPageSelection(rect);
    } else {
      await handleSelection(rect);
    }
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
        priorBubbles: sessionLog.slice(),
      });

      loading.remove();

      if (resp && resp.ok) {
        const text = resp.text || '';
        const overlay = renderOverlay(rect, text || '(no text detected)', { loading: false });
        if (text) addToLog(text, resp.readingText, resp.translation, overlay);
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

  // ---------- Full-page scan ----------

  async function handleFullPageSelection(rect) {
    toggleLog(true);

    const placeholder = document.createElement('div');
    placeholder.className = 'mra-log-scanning';
    placeholder.textContent = 'Scanning selection…';
    logEntries.appendChild(placeholder);
    logEntries.scrollTop = logEntries.scrollHeight;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'FULL_PAGE_REGION',
        rect,
        dpr: window.devicePixelRatio || 1,
      });
      placeholder.remove();

      if (resp?.ok && resp.bubbles?.length) {
        resp.bubbles.forEach((b) => addToLog(b.text, b.readingText, b.translation));
      } else {
        placeholder.textContent = resp?.error
          ? `Scan failed: ${resp.error}`
          : 'No Japanese text found in selection.';
        logEntries.appendChild(placeholder);
      }
    } catch (err) {
      placeholder.textContent = `Scan failed: ${err.message}`;
    }
  }

  // ---------- Overlay rendering ----------
  // The overlay is a fixed-position div containing the OCR'd text as REAL DOM text.
  // Yomitan and other dictionary extensions will pick it up natively on hover.

  function renderOverlay(rect, text, { loading = false, error = false } = {}) {
    const el = document.createElement('div');
    el.className = 'mra-overlay';
    el.setAttribute('translate', 'no');
    if (loading) el.classList.add('mra-overlay-loading');
    if (error) el.classList.add('mra-overlay-error');

    el.style.left = `${rect.x + window.scrollX}px`;
    el.style.top = `${rect.y + window.scrollY}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    el.style.overflow = 'hidden';

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

    // Accessing scrollHeight forces layout — check if text overflows the selection.
    if (!loading && el.scrollHeight > el.clientHeight) {
      const badge = document.createElement('div');
      badge.className = 'mra-clipped-badge';
      badge.textContent = '[...]';
      el.appendChild(badge);

      el.addEventListener('mouseenter', () => {
        el.style.height = 'auto';
        el.style.overflow = 'visible';
        el.style.zIndex = '2147483646';
        badge.style.display = 'none';
      });
      el.addEventListener('mouseleave', () => {
        el.style.height = `${rect.h}px`;
        el.style.overflow = 'hidden';
        el.style.zIndex = '';
        badge.style.display = '';
      });
    }

    return el;
  }

  // ---------- Messages from popup / background ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'TOGGLE_SELECTION') {
      if (selectionMode && !isFullPageMode) exitSelectionMode();
      else enterSelectionMode(false);
      sendResponse({ ok: true, selectionMode });
      return true;
    }
    if (msg.type === 'TOGGLE_FULLPAGE_SELECTION') {
      if (selectionMode && isFullPageMode) exitSelectionMode();
      else enterSelectionMode(true);
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'CLEAR_OVERLAYS') {
      overlays.splice(0).forEach((o) => o.remove());
      sendResponse({ ok: true });
      return true;
    }
  });
})();
