// TAW YouTube popup — passive renderer. Background owns state.

const $ = (id) => document.getElementById(id);
const tierSelect = $("tier");
const voiceSelect = $("voice");
const langSelect = $("lang");
const openaiKeyInput = $("openaiKey");
const keyBadge = $("keyBadge");
const toggleBtn = $("toggle");
const statusEl = $("status");
const originalVolumeInput = $("originalVolume");
const voiceVolumeInput = $("voiceVolume");
const originalOut = $("originalOut");
const voiceOut = $("voiceOut");
const showSourceCheckbox = $("showSource");
const tierBadge = $("tier-badge");

const LANGUAGES = [
  ["en", "English"], ["vi", "Vietnamese"], ["ja", "Japanese"],
  ["ko", "Korean"], ["zh", "Chinese"], ["fr", "French"],
  ["es", "Spanish"], ["de", "German"], ["pt", "Portuguese"],
  ["hi", "Hindi"], ["id", "Indonesian"], ["it", "Italian"],
  ["ru", "Russian"],
];

const OPENAI_VOICES = [
  { id: "marin", name: "Marin" },
  { id: "alloy", name: "Alloy" },
  { id: "ash", name: "Ash" },
  { id: "ballad", name: "Ballad" },
  { id: "coral", name: "Coral" },
  { id: "echo", name: "Echo" },
  { id: "fable", name: "Fable" },
  { id: "onyx", name: "Onyx" },
  { id: "nova", name: "Nova" },
  { id: "sage", name: "Sage" },
  { id: "shimmer", name: "Shimmer" },
  { id: "verse", name: "Verse" },
  { id: "cedar", name: "Cedar" },
];

let state = {
  running: false,
  connecting: false,
  paused: false,
  tier: "smart",
  targetLanguage: "vi",
  realtimeVoice: "marin",
  standardVoice: "marin",
  originalVolume: 18,
  voiceVolume: 100,
  showSource: true,
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

function repopulateVoices(preferredVoiceId) {
  voiceSelect.replaceChildren();
  for (const v of OPENAI_VOICES) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    voiceSelect.appendChild(opt);
  }
  const wanted = preferredVoiceId || "marin";
  const match = Array.from(voiceSelect.options).some((o) => o.value === wanted);
  voiceSelect.value = match ? wanted : "marin";
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

function applyState(s) {
  state = { ...state, ...s };
  if (tierBadge) {
    tierBadge.dataset.tier = state.openaiKey?.trim() ? "byok" : "free";
    tierBadge.textContent = state.openaiKey?.trim() ? "OpenAI" : "Key needed";
  }

  if (typeof state.tier === "string") {
    tierSelect.value = ["smart", "standard", "realtime"].includes(state.tier)
      ? state.tier
      : "smart";
  }
  if (typeof state.targetLanguage === "string") langSelect.value = state.targetLanguage;

  const activeVoice = tierSelect.value === "standard" ? state.standardVoice : state.realtimeVoice;
  repopulateVoices(activeVoice);
  voiceSelect.disabled = tierSelect.value === "smart";
  voiceSelect.closest(".row")?.classList.toggle("is-disabled", tierSelect.value === "smart");

  if (typeof state.originalVolume === "number") {
    originalVolumeInput.value = state.originalVolume;
    originalOut.textContent = state.originalVolume;
  }
  if (typeof state.voiceVolume === "number") {
    voiceVolumeInput.value = state.voiceVolume;
    voiceOut.textContent = state.voiceVolume;
  }
  if (typeof state.showSource === "boolean") showSourceCheckbox.checked = tierSelect.value === "smart" ? true : state.showSource;
  showSourceCheckbox.disabled = tierSelect.value === "smart";
  if (typeof state.openaiKey === "string") {
    if (openaiKeyInput.value !== state.openaiKey) openaiKeyInput.value = state.openaiKey;
    setKeyBadge(state.openaiKey);
  }

  if (state.connecting) {
    setStateClass("connecting");
    statusEl.textContent = state.status || "Connecting";
    toggleBtn.textContent = "Stop";
    toggleBtn.classList.add("is-live");
  } else if (state.running && state.paused) {
    setStateClass("paused");
    statusEl.textContent = "Paused.";
    toggleBtn.textContent = "Stop";
    toggleBtn.classList.add("is-live");
  } else if (state.running) {
    setStateClass("active");
    const langName = LANGUAGES.find(([c]) => c === state.targetLanguage)?.[1] || state.targetLanguage;
    statusEl.textContent = `Translating to ${langName}.`;
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
      ? "Ready."
      : "Paste an OpenAI API key to start.";
    toggleBtn.textContent = "Start";
    toggleBtn.classList.remove("is-live");
  }
  toggleBtn.disabled = false;
}

function readSettings() {
  const tier = tierSelect.value;
  const voiceKey = tier === "standard" ? "standardVoice" : "realtimeVoice";
  return {
    tier,
    targetLanguage: langSelect.value,
    [voiceKey]: voiceSelect.value,
    originalVolume: Number(originalVolumeInput.value),
    voiceVolume: Number(voiceVolumeInput.value),
    showSource: tier === "smart" ? true : showSourceCheckbox.checked,
    openaiKey: openaiKeyInput.value.trim(),
  };
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

let volumeDebounce = null;
function onVolumeChange() {
  originalOut.textContent = originalVolumeInput.value;
  voiceOut.textContent = voiceVolumeInput.value;
  clearTimeout(volumeDebounce);
  volumeDebounce = setTimeout(() => {
    chrome.runtime.sendMessage({
      type: "UPDATE_VOLUME",
      originalVolume: Number(originalVolumeInput.value),
      voiceVolume: Number(voiceVolumeInput.value),
    }).catch(() => {});
  }, 60);
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

tierSelect.addEventListener("change", () => {
  const wanted = tierSelect.value === "standard" ? state.standardVoice : state.realtimeVoice;
  repopulateVoices(wanted);
  voiceSelect.disabled = tierSelect.value === "smart";
  voiceSelect.closest(".row")?.classList.toggle("is-disabled", tierSelect.value === "smart");
  showSourceCheckbox.checked = tierSelect.value === "smart" ? true : showSourceCheckbox.checked;
  showSourceCheckbox.disabled = tierSelect.value === "smart";
  pushSettings();
});
voiceSelect.addEventListener("change", pushSettings);
langSelect.addEventListener("change", pushSettings);
showSourceCheckbox.addEventListener("change", pushSettings);
openaiKeyInput.addEventListener("input", () => setKeyBadge(openaiKeyInput.value.trim()));
openaiKeyInput.addEventListener("change", pushSettings);
originalVolumeInput.addEventListener("input", onVolumeChange);
voiceVolumeInput.addEventListener("input", onVolumeChange);
toggleBtn.addEventListener("click", onToggle);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "BACKGROUND_STATE_UPDATE" && message.state) {
    applyState(message.state);
  }
});

populateLanguages();
repopulateVoices(state.realtimeVoice);
voiceSelect.disabled = true;
voiceSelect.closest(".row")?.classList.add("is-disabled");
showSourceCheckbox.checked = true;
showSourceCheckbox.disabled = true;

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
