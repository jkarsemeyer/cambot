// Settings, saved between sessions on this computer.

const KEY = "cambot.v2";
const DEFAULTS = {
  effect: "storm-caller",
  mirror: true,
  debug: false,
  gpu: false,
  vcam: true,
  // sound on this computer (headphones or speakers)
  monitorDevice: "",
  monitorVol: 0.9,
  hearSfx: true,
  hearVoice: false,
  sfxVol: 0.8,
  // sound sent into calls (a virtual cable such as VB-Cable)
  callDevice: "",
  callSfx: true,
  voiceForce: false,
  effects: {},
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULTS, ...saved, effects: { ...(saved.effects || {}) } };
  } catch {
    return { ...DEFAULTS, effects: {} };
  }
}

export const cfg = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
}

// Settings for one effect: the effect's own defaults, overridden by anything saved.
export function effectCfg(effect) {
  const saved = (cfg.effects[effect.id] ||= {});
  for (const s of effect.settings || []) if (!(s.key in saved)) saved[s.key] = s.default;
  saved.voice = { pitch: 1, electric: 0, ...(effect.voice || {}), ...(saved.voice || {}) };
  return saved;
}

export function resetEffectCfg(effect) {
  delete cfg.effects[effect.id];
  save();
  return effectCfg(effect);
}
