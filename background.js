// TAW YouTube background service worker.
//
// Popup is a passive renderer. The content script owns the YouTube capture,
// Realtime WebRTC session, overlay, and audio playback. Background keeps the
// canonical state and injects the content script when needed.

const DEFAULT_SETTINGS = {
  tier: "smart",
  targetLanguage: "vi",
  realtimeVoice: "marin",
  standardVoice: "marin",
  originalVolume: 18,
  voiceVolume: 100,
  showSource: true,
  openaiKey: "",
};

const OPENAI_API_BASE = "https://api.openai.com/v1";

// YouTube CC URL cache. Populated when YouTube itself fires a signed
// /api/timedtext request, then reused by content.js for subtitle-first mode.
const ytCaptionCache = new Map();
const YT_CACHE_TTL_MS = 30 * 60 * 1000;
const YT_CACHE_GC_MS = 5 * 60 * 1000;

if (typeof chrome.webRequest?.onCompleted?.addListener === "function") {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      try {
        if (details.statusCode !== 200) return;
        const u = new URL(details.url);
        const videoId = u.searchParams.get("v");
        if (!videoId) return;
        const isAsr = u.searchParams.get("kind") === "asr";
        const existing = ytCaptionCache.get(videoId);
        if (existing && !existing.isAsr && isAsr) return;
        ytCaptionCache.set(videoId, {
          url: details.url,
          lang: u.searchParams.get("lang") || null,
          kind: u.searchParams.get("kind") || null,
          tlang: u.searchParams.get("tlang") || null,
          isAsr,
          capturedAt: Date.now(),
        });
      } catch {}
    },
    {
      urls: [
        "*://*.youtube.com/api/timedtext*",
        "*://*.youtube-nocookie.com/api/timedtext*",
      ],
    },
  );

  setInterval(() => {
    const cutoff = Date.now() - YT_CACHE_TTL_MS;
    for (const [id, v] of ytCaptionCache) {
      if (v.capturedAt < cutoff) ytCaptionCache.delete(id);
    }
  }, YT_CACHE_GC_MS);
}

const state = {
  running: false,
  connecting: false,
  paused: false,
  tabId: null,
  status: "Ready",
  errorMessage: "",
  apiMode: null,
  ...DEFAULT_SETTINGS,
};

let autoRestartTimer = null;

chrome.storage.local
  .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch(() => {});

let lastBroadcastAt = 0;
const BROADCAST_DEBOUNCE_MS = 50;

function snapshot() {
  return { ...state };
}

function broadcastToPopup() {
  const now = Date.now();
  if (now - lastBroadcastAt < BROADCAST_DEBOUNCE_MS) return;
  lastBroadcastAt = now;
  chrome.runtime
    .sendMessage({ type: "BACKGROUND_STATE_UPDATE", state: snapshot() })
    .catch(() => {});
}

async function relayToContent(tabId, message) {
  if (!tabId) throw new Error("No active tab to relay to.");
  return chrome.tabs.sendMessage(tabId, message);
}

function isYouTubeUrl(url) {
  return typeof url === "string" && /^https?:\/\/[^/]*youtube\.com\//.test(url);
}

function isYouTubeWatchUrl(url) {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === "/watch" && !!u.searchParams.get("v");
  } catch {
    return false;
  }
}

async function activeYouTubeTab(preferredTabId = null) {
  const tab = preferredTabId
    ? await chrome.tabs.get(preferredTabId)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) throw new Error("No active tab.");
  if (!isYouTubeUrl(tab.url)) throw new Error("Open a YouTube video first.");
  if (!isYouTubeWatchUrl(tab.url)) throw new Error("Open a YouTube video first.");
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: "CONTENT_PING" });
    if (reply?.ok) return;
  } catch {}
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    });
  } catch {}
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  Object.assign(state, stored);
  state.apiMode = state.openaiKey?.trim() ? "openai" : null;
  return stored;
}

async function persistSettings(partial) {
  Object.assign(state, partial);
  const persistable = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k in partial) persistable[k] = state[k];
  }
  if (Object.keys(persistable).length) {
    await chrome.storage.local.set(persistable);
  }
  state.apiMode = state.openaiKey?.trim() ? "openai" : null;
}

function resolveApiMode(settings) {
  const openaiKey = (settings.openaiKey ?? "").trim();
  if (!openaiKey) return null;
  return { apiBase: OPENAI_API_BASE, apiKey: openaiKey, mode: "openai" };
}

function clearAutoRestart() {
  if (autoRestartTimer) {
    clearTimeout(autoRestartTimer);
    autoRestartTimer = null;
  }
}

function scheduleAutoRestart(tabId) {
  clearAutoRestart();
  autoRestartTimer = setTimeout(async () => {
    autoRestartTimer = null;
    if (state.tabId !== tabId) return;
    if (!state.openaiKey?.trim()) return;
    if (state.running || state.connecting) return;
    await handleStart(snapshot(), tabId);
  }, 900);
}

async function handleStart(settings, preferredTabId = null) {
  if (state.running || state.connecting) {
    return { ok: false, error: "Session already running." };
  }
  await persistSettings(settings || {});

  const mode = resolveApiMode(state);
  if (!mode) {
    state.errorMessage = "Paste an OpenAI API key to start.";
    state.status = state.errorMessage;
    state.connecting = false;
    broadcastToPopup();
    return { ok: false, error: state.errorMessage };
  }
  state.apiMode = mode.mode;

  let tab;
  try {
    tab = await activeYouTubeTab(preferredTabId);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  state.tabId = tab.id;
  state.connecting = true;
  state.errorMessage = "";
  state.status = "Connecting";
  broadcastToPopup();

  try {
    await ensureContentScript(tab.id);
    const startSettings = {
      ...snapshot(),
      apiBase: mode.apiBase,
      openaiKey: mode.apiKey,
    };
    const reply = await relayToContent(tab.id, {
      type: "CONTENT_START",
      settings: startSettings,
    });
    if (!reply?.ok) {
      throw new Error(reply?.error || "Could not start translation.");
    }
    state.connecting = false;
    state.running = true;
    state.status = state.status && state.status !== "Connecting" ? state.status : "Translating";
    broadcastToPopup();
    return { ok: true, state: snapshot() };
  } catch (err) {
    state.connecting = false;
    state.running = false;
    state.errorMessage = err.message || String(err);
    state.status = state.errorMessage;
    broadcastToPopup();
    return { ok: false, error: state.errorMessage };
  }
}

async function handleStop() {
  clearAutoRestart();
  const tabId = state.tabId;
  state.running = false;
  state.connecting = false;
  state.paused = false;
  state.status = "Stopped";
  broadcastToPopup();
  if (tabId) {
    try {
      await relayToContent(tabId, { type: "CONTENT_STOP" });
    } catch {}
  }
  state.tabId = null;
  return { ok: true, state: snapshot() };
}

async function handleVideoNavigation(tabId, url) {
  if (tabId !== state.tabId) return;
  const shouldRestart = state.running || state.connecting;
  clearAutoRestart();
  try {
    await relayToContent(tabId, { type: "CONTENT_STOP" });
  } catch {}

  state.running = false;
  state.connecting = false;
  state.paused = false;
  state.errorMessage = "";

  if (shouldRestart && isYouTubeWatchUrl(url) && state.openaiKey?.trim()) {
    state.tabId = tabId;
    state.status = "Opening video";
    broadcastToPopup();
    scheduleAutoRestart(tabId);
    return;
  }

  state.tabId = null;
  state.status = shouldRestart ? "Open a YouTube video first." : "Stopped";
  broadcastToPopup();
}

async function handleUpdateSettings(settings) {
  await persistSettings(settings || {});
  broadcastToPopup();
  if (state.tabId && (state.running || state.connecting)) {
    try {
      const reply = await relayToContent(state.tabId, {
        type: "CONTENT_UPDATE_SETTINGS",
        settings: snapshot(),
      });
      if (reply?.state) Object.assign(state, reply.state);
    } catch (err) {
      state.errorMessage = err.message || String(err);
      broadcastToPopup();
    }
  }
  return { ok: true, state: snapshot() };
}

async function handleUpdateVolume(originalVolume, voiceVolume) {
  if (typeof originalVolume === "number") state.originalVolume = originalVolume;
  if (typeof voiceVolume === "number") state.voiceVolume = voiceVolume;
  chrome.storage.local
    .set({ originalVolume: state.originalVolume, voiceVolume: state.voiceVolume })
    .catch(() => {});

  let targetTabId = state.tabId;
  if (!targetTabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && isYouTubeUrl(tab.url)) targetTabId = tab.id;
    } catch {}
  }

  if (targetTabId) {
    try {
      await ensureContentScript(targetTabId);
      await relayToContent(targetTabId, {
        type: "CONTENT_UPDATE_VOLUME",
        originalVolume: state.originalVolume,
        voiceVolume: state.voiceVolume,
      });
    } catch {}
  }
  return { ok: true };
}

function handleContentEvent(message) {
  if (message.type === "CONTENT_STATE") {
    if (typeof message.running === "boolean") state.running = message.running;
    if (typeof message.connecting === "boolean") state.connecting = message.connecting;
    if (typeof message.paused === "boolean") state.paused = message.paused;
    if (typeof message.status === "string") state.status = message.status;
    if (typeof message.errorMessage === "string") state.errorMessage = message.errorMessage;
    broadcastToPopup();
  }
  if (message.type === "CONTENT_NAVIGATED") {
    void handleVideoNavigation(message.tabId, message.url);
  }
  if (message.type === "CONTENT_ENDED") {
    clearAutoRestart();
    state.running = false;
    state.connecting = false;
    state.paused = false;
    state.tabId = null;
    state.status = message.reason || "Stopped";
    broadcastToPopup();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.tab && message?.type === "GET_YT_CC_URL") {
    const entry = message.videoId ? ytCaptionCache.get(message.videoId) : null;
    sendResponse({ ok: !!entry, ...(entry || {}) });
    return false;
  }

  if (sender.tab) {
    if (message?.type === "CONTENT_NAVIGATED") message.tabId = sender.tab.id;
    handleContentEvent(message);
    sendResponse?.({ ok: true });
    return false;
  }

  (async () => {
    try {
      switch (message?.type) {
        case "GET_STATE":
          await loadSettings();
          sendResponse({ ok: true, state: snapshot() });
          break;
        case "START":
          sendResponse(await handleStart(message.settings));
          break;
        case "STOP":
          sendResponse(await handleStop());
          break;
        case "UPDATE_SETTINGS":
          sendResponse(await handleUpdateSettings(message.settings));
          break;
        case "UPDATE_VOLUME":
          sendResponse(await handleUpdateVolume(
            message.originalVolume,
            message.voiceVolume,
          ));
          break;
        default:
          sendResponse({ ok: false, error: "Unknown message: " + message?.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId) void handleStop();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== state.tabId) return;
  if (!changeInfo.url) return;
  void handleVideoNavigation(tabId, changeInfo.url);
});

void loadSettings();
