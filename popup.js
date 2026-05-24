// TAW YouTube popup — Smart captions only.

const $ = (id) => document.getElementById(id);
const langSelect = $("lang");
const openaiKeyInput = $("openaiKey");
const keyBadge = $("keyBadge");
const toggleBtn = $("toggle");
const statusEl = $("status");
const tierBadge = $("tier-badge");

const LANGUAGES = [
  ["vi", "Vietnamese"], ["en", "English"], ["ja", "Japanese"],
  ["ko", "Korean"], ["zh", "Chinese"], ["fr", "French"],
  ["es", "Spanish"], ["de", "German"], ["pt", "Portuguese"],
  ["hi", "Hindi"], ["id", "Indonesian"], ["it", "Italian"],
  ["ru", "Russian"],
];

let state = {
  running: false,
  connecting: false,
  paused: false,
  targetLanguage: "vi",
  openaiKey: "",
  status: "Ready",
};

function populateLanguages() {
  for (const [code, name] of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    langSelect.appendChild(opt);
  }
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply) => {
      const e = chrome.runtime.lastError;
      if (e) reject(new Error(e.message));
      else resolve(reply);
    });
  });
}

function isBenign(msg) {
  return !!msg && /message channel closed|asynchronous response|message port closed|Receiving end does not exist/i.test(msg);
}

function setStateClass(name) {
  document.body.dataset.state = name;
}

function setKeyBadge(k) {
  keyBadge.classList.remove("ok", "warn");
  if (!k) {
    keyBadge.textContent = "missing";
  } else if (k.startsWith("sk-")) {
    keyBadge.textContent = "saved";
    keyBadge.classList.add("ok");
  } else {
    keyBadge.textContent = "check";
    keyBadge.classList.add("warn");
  }
}

function readSettings() {
  return {
    tier: "smart",
    targetLanguage: langSelect.value,
    realtimeVoice: "marin",
    standardVoice: "marin",
    originalVolume: 100,
    voiceVolume: 0,
    showSource: true,
    openaiKey: openaiKeyInput.value.trim(),
  };
}

function applyState(s) {
  state = { ...state, ...s };
  if (tierBadge) {
    tierBadge.dataset.tier = state.openaiKey?.trim() ? "byok" : "free";
    tierBadge.textContent = state.openaiKey?.trim() ? "OpenAI" : "Key needed";
  }
  if (typeof state.targetLanguage === "string") langSelect.value = state.targetLanguage;
  if (typeof state.openaiKey === "string") {
    if (openaiKeyInput.value !== state.openaiKey) openaiKeyInput.value = state.openaiKey;
    setKeyBadge(state.openaiKey);
  }

  if (state.connecting) {
    setStateClass("connecting");
    statusEl.textContent = state.status || "Finding captions...";
    toggleBtn.textContent = "Stop";
    toggleBtn.classList.add("is-live");
  } else if (state.running) {
    setStateClass("active");
    statusEl.textContent = state.status || "Captions ready.";
    toggleBtn.textContent = "Stop";
    toggleBtn.classList.add("is-live");
  } else if (state.errorMessage) {
    setStateClass("error");
    statusEl.textContent = state.errorMessage;
    toggleBtn.textContent = "Start";
    toggleBtn.classList.remove("is-live");
  } else {
    setStateClass("idle");
    statusEl.textContent = state.openaiKey?.trim()
      ? "Ready. Open a YouTube video and press Start."
      : "Paste an OpenAI API key to start.";
    toggleBtn.textContent = "Start";
    toggleBtn.classList.remove("is-live");
  }
  toggleBtn.disabled = false;
}

async function pushSettings() {
  try {
    const reply = await send({ type: "UPDATE_SETTINGS", settings: readSettings() });
    if (reply?.state) applyState(reply.state);
  } catch (err) {
    if (!isBenign(err.message)) {
      statusEl.textContent = err.message;
      setStateClass("error");
    }
  }
}

async function onToggle() {
  toggleBtn.disabled = true;
  try {
    if (state.running || state.connecting) {
      const reply = await send({ type: "STOP" });
      if (reply?.state) applyState(reply.state);
      else applyState({ running: false, connecting: false, paused: false });
    } else {
      const settings = readSettings();
      if (!settings.openaiKey) {
        statusEl.textContent = "Paste an OpenAI API key.";
        setStateClass("error");
        toggleBtn.disabled = false;
        return;
      }
      statusEl.textContent = "Finding captions...";
      setStateClass("connecting");
      const reply = await send({ type: "START", settings });
      if (!reply?.ok) {
        statusEl.textContent = reply?.error || "Could not start.";
        setStateClass("error");
        toggleBtn.disabled = false;
        return;
      }
      if (reply?.state) applyState(reply.state);
    }
  } catch (err) {
    toggleBtn.disabled = false;
    if (isBenign(err.message)) return;
    statusEl.textContent = err.message;
    setStateClass("error");
  }
}

langSelect.addEventListener("change", pushSettings);
openaiKeyInput.addEventListener("input", () => setKeyBadge(openaiKeyInput.value.trim()));
openaiKeyInput.addEventListener("change", pushSettings);
toggleBtn.addEventListener("click", onToggle);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "BACKGROUND_STATE_UPDATE" && message.state) {
    applyState(message.state);
  }
});

populateLanguages();

(async () => {
  try {
    const reply = await send({ type: "GET_STATE" });
    if (reply?.state) applyState(reply.state);
  } catch (err) {
    if (!isBenign(err.message)) {
      statusEl.textContent = err.message;
      setStateClass("error");
    }
  }
})();
