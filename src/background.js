// Background service worker (MV3).
//
// Captures the visible tab, crops the requested region, sends it to whichever
// OCR provider the user picked in the popup (Anthropic, OpenAI, Google, or
// the local manga-ocr server).

import { runOcr, runFullPageOcr } from './providers.js';

// Keyboard shortcut → forward to active tab
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === 'toggle-select-mode') {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SELECTION' }).catch(() => {});
  } else if (command === 'clear-overlays') {
    chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_OVERLAYS' }).catch(() => {});
  } else if (command === 'full-page-select') {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_FULLPAGE_SELECTION' }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OCR_REGION') {
    handleOcrRegion(msg, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
  if (msg.type === 'FULL_PAGE_REGION') {
    handleFullPageRegion(msg, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
});

async function handleOcrRegion({ rect, dpr, priorBubbles = [] }, sender) {
  if (!sender.tab?.windowId) throw new Error('No window context');

  // 1. Screenshot the viewport.
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
    format: 'png',
  });

  // 2. Crop to the user's drag rectangle.
  const cropped = await cropImage(dataUrl, rect, dpr);

  // 3. Load provider settings and dispatch.
  const settings = await getSettings();
  let text, readingText, translation;
  try {
    ({ text, readingText, translation } = await runOcr(cropped, settings, priorBubbles));
  } catch (err) {
    throw new Error(`OCR failed (${settings.provider}): ${err.message}`);
  }
  return { ok: true, text, readingText, translation };
}

async function handleFullPageRegion({ rect, dpr }, sender) {
  if (!sender.tab?.windowId) throw new Error('No window context');
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
  const cropped = await cropImage(dataUrl, rect, dpr);
  const settings = await getSettings();
  const bubbles = await runFullPageOcr(cropped, settings);
  return { ok: true, bubbles };
}

// ---------- Settings ----------

async function getSettings() {
  const s = await chrome.storage.local.get([
    'provider',
    'model',
    'apiKeyAnthropic',
    'apiKeyOpenAI',
    'apiKeyGoogle',
    'localUrl',
    'useContext',
  ]);
  const provider = s.provider || 'anthropic';
  const defaultModelByProvider = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai: 'gpt-4o-mini',
    google: 'gemini-2.5-flash-lite',
    local: 'manga-ocr',
  };
  return {
    provider,
    model: s.model || defaultModelByProvider[provider],
    apiKey:
      provider === 'anthropic' ? s.apiKeyAnthropic :
      provider === 'openai'    ? s.apiKeyOpenAI    :
      provider === 'google'    ? s.apiKeyGoogle    : '',
    localUrl: s.localUrl || 'http://localhost:7331/ocr',
    useContext: !!s.useContext,
  };
}

// ---------- Image cropping (OffscreenCanvas; service workers have no DOM) ----------

async function cropImage(dataUrl, rect, dpr) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  // captureVisibleTab returns pixels at device-pixel resolution, so multiply
  // CSS coordinates by dpr to address the right region.
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.round(rect.w * dpr);
  const sh = Math.round(rect.h * dpr);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToBase64(outBlob);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
