import { MODELS } from './providers.js';

// ---------- Helpers ----------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  // Static content script declared in manifest only runs on document_idle.
  // If popup opens before that, or the extension was just installed, inject now.
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content.js'],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['src/overlay.css'],
      });
    } catch (e) {
      console.warn('Cannot inject into this page:', e.message);
    }
  }
}

// ---------- Element refs ----------

const $ = (id) => document.getElementById(id);
const providerEl = $('provider');
const modelEl = $('model');
const apiKeyEl = $('api-key');
const keyLabelEl = $('key-label');
const keyRowEl = $('key-row');
const localRowEl = $('local-row');
const localUrlEl = $('local-url');
const hintEl = $('hint');

// ---------- Actions ----------

$('toggle').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  await ensureContentScript(tab.id);
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SELECTION' });
  window.close();
});

$('clear').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_OVERLAYS' }).catch(() => {});
});

// ---------- Provider/model UI ----------

function refreshModelOptions(provider, selectedModel) {
  modelEl.innerHTML = '';
  for (const m of MODELS[provider]) {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    if (m.value === selectedModel) opt.selected = true;
    modelEl.appendChild(opt);
  }
}

function refreshProviderUI(provider) {
  const isLocal = provider === 'local';
  keyRowEl.hidden = isLocal;
  localRowEl.hidden = !isLocal;

  const labels = {
    anthropic: 'Anthropic API key',
    openai: 'OpenAI API key',
    google: 'Google API key',
  };
  keyLabelEl.textContent = labels[provider] || 'API key';

  const hints = {
    anthropic:
      'Get a key at <code>console.anthropic.com</code>. Stored locally in <code>chrome.storage</code>.',
    openai:
      'Get a key at <code>platform.openai.com</code>. Stored locally in <code>chrome.storage</code>.',
    google:
      'Get a key at <code>aistudio.google.com</code>. Stored locally in <code>chrome.storage</code>.',
    local:
      'Run the included Python server (<code>backend/server.py</code>) on port 7331.',
  };
  hintEl.innerHTML = hints[provider];
}

providerEl.addEventListener('change', async () => {
  const provider = providerEl.value;
  refreshProviderUI(provider);
  // Reset to that provider's default model + load its stored key.
  const stored = await chrome.storage.local.get([
    `apiKey${capitalize(provider)}`,
    'localUrl',
  ]);
  refreshModelOptions(provider, null);
  apiKeyEl.value = stored[`apiKey${capitalize(provider)}`] || '';
  localUrlEl.value = stored.localUrl || '';
});

function capitalize(s) {
  // anthropic -> Anthropic, openai -> Openai, google -> Google
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Match the actual storage keys (apiKeyAnthropic, apiKeyOpenAI, apiKeyGoogle).
function keyFieldName(provider) {
  return {
    anthropic: 'apiKeyAnthropic',
    openai: 'apiKeyOpenAI',
    google: 'apiKeyGoogle',
  }[provider];
}

// ---------- Save ----------

$('save').addEventListener('click', async () => {
  const provider = providerEl.value;
  const model = modelEl.value;
  const updates = { provider, model };

  if (provider === 'local') {
    updates.localUrl = localUrlEl.value.trim() || 'http://localhost:7331/ocr';
  } else {
    const field = keyFieldName(provider);
    if (field) updates[field] = apiKeyEl.value.trim();
  }

  await chrome.storage.local.set(updates);

  const btn = $('save');
  const orig = btn.textContent;
  btn.textContent = 'Saved ✓';
  btn.classList.add('save-flash');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('save-flash');
  }, 1200);
});

// ---------- Initial load ----------

(async function init() {
  const s = await chrome.storage.local.get([
    'provider',
    'model',
    'apiKeyAnthropic',
    'apiKeyOpenAI',
    'apiKeyGoogle',
    'localUrl',
  ]);
  const provider = s.provider || 'anthropic';
  providerEl.value = provider;
  refreshProviderUI(provider);
  refreshModelOptions(provider, s.model);

  const field = keyFieldName(provider);
  apiKeyEl.value = (field && s[field]) || '';
  localUrlEl.value = s.localUrl || '';
})();
