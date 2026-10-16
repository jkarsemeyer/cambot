// CAMBOT: start-up, the frame loop, effect switching and the control panel.

import { cfg, save, effectCfg, resetEffectCfg } from "./config.js";
import { bus } from "./bus.js";
import { audio } from "./audio.js";
import { vcam } from "./vcam.js";
import { readHands, readFace } from "./gestures.js";
import { createHandTracker, createFaceTracker, createSegmenter } from "./trackers.js";
import { cutout } from "./cutout.js";
import { Holds, withTimeout, rand, escapeHtml } from "./util.js";
import { HAND_BONES, vignette, drawLabels } from "./draw.js";
import { EFFECTS } from "./effects/index.js";
import { createShortcuts, SHORTCUTS } from "./shortcuts.js";

const $ = id => document.getElementById(id);
const out = $("out"), octx = out.getContext("2d");               // the clean picture calls receive
const overlay = $("overlay"), vctx = overlay.getContext("2d");
const textLayer = $("text"), tctx = textLayer.getContext("2d");    // effect text (names), screen copy   // guides and tracking points, screen only
const video = $("cam");
const view = { W: 1280, H: 720, get mirror() { return cfg.mirror; } };
const isDesktop = !!(window.cambot && window.cambot.isDesktop);
const isMac = isDesktop ? window.cambot.platform === "darwin" : /Mac/.test(navigator.platform);
// Virtual audio cable: VB-Cable on Windows, BlackHole on Mac.
const CABLE_OUT = /CABLE Input|BlackHole/i, CABLE_IN = /^CABLE Output|BlackHole/i;
document.body.classList.toggle("desktop", isDesktop);

/* ---------------------------------------------------------------- event log */
const t0 = performance.now();
bus.setLogger((name, data) => {
  const li = document.createElement("li");
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  li.innerHTML = `<i>${s}s</i><span>${escapeHtml(name)}${data ? " · " + escapeHtml(data) : ""}</span>`;
  const log = $("log");
  log.prepend(li);
  while (log.children.length > 60) log.lastChild.remove();
});

/* ---------------------------------------------------------------- systems
   Each part starts on its own, with a time limit, a status light and a Retry button. */
const SYSTEMS = {
  camera: { label: "Camera", run: startCamera },
  mic:    { label: "Microphone", run: startMic },
  sound:  { label: "Sound", run: startSound },
  hands:  { label: "Hand tracking", run: startHands },
  face:   { label: "Face tracking", run: startFace },
  vcam:   { label: "CAMBOT Camera", run: startVcam },
};
for (const s of Object.values(SYSTEMS)) Object.assign(s, { state: "waiting", msg: "", action: null });
const sysOk = key => SYSTEMS[key].state === "ok";

function explain(e) {
  if (!e) return "unknown error";
  if (e.name === "NotAllowedError") return "permission blocked. Allow it, then Retry";
  if (e.name === "NotFoundError" || e.name === "OverconstrainedError") return "no device found. Plug it in, then Retry";
  if (e.name === "NotReadableError" || e.name === "AbortError") return "in use by another app. Close Zoom, Teams or similar, then Retry";
  return e.message || String(e);
}

async function runSys(key) {
  const s = SYSTEMS[key];
  if (s.state === "starting") return s.promise;
  const began = performance.now();
  Object.assign(s, { state: "starting", msg: "starting…", action: null });
  renderSys();
  const tick = setInterval(() => {
    if (!/…$/.test(s.msg) && !/…\s\d+s$/.test(s.msg)) return;
    s.msg = s.msg.replace(/\s\d+s$/, "") + ` ${Math.round((performance.now() - began) / 1000)}s`;
    renderSys();
  }, 1000);
  s.promise = (async () => {
    try {
      const detail = await s.run(m => { s.msg = m; renderSys(); });
      Object.assign(s, { state: detail === "off" ? "off" : "ok", msg: detail === "off" ? s.offMsg || "off" : detail || "ready" });
      bus.emit(`${key}_ready`, detail);
    } catch (e) {
      console.warn(key, e);
      Object.assign(s, { state: "error", msg: explain(e), action: e.action || { label: "Retry", fn: () => runSys(key) } });
      bus.emit(`${key}_failed`, explain(e));
    } finally {
      clearInterval(tick);
      renderSys();
    }
  })();
  return s.promise;
}

function renderSys() {
  $("sysList").innerHTML = Object.entries(SYSTEMS).map(([key, s]) => `
    <li class="sys ${s.state}">
      <span class="dot" aria-hidden="true"></span>
      <span class="name">${s.label}</span>
      <span class="msg">${escapeHtml(s.msg)}</span>
      ${s.action ? `<button class="btn ghost small" data-key="${key}">${escapeHtml(s.action.label)}</button>` : ""}
    </li>`).join("");
}
$("sysList").addEventListener("click", e => {
  const key = e.target.dataset && e.target.dataset.key;
  if (key && SYSTEMS[key].action) SYSTEMS[key].action.fn();
});

/* camera and microphone */
let camStream = null, micStream = null;
async function openCamera(deviceId) {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = camStream;
  await video.play();
  if (!video.videoWidth) await new Promise(r => video.addEventListener("loadedmetadata", r, { once: true }));
  view.W = out.width = overlay.width = textLayer.width = video.videoWidth || 1280;
  view.H = out.height = overlay.height = textLayer.height = video.videoHeight || 720;
}
async function startCamera() {
  await withTimeout(openCamera($("camDev").value || cfg.camDevice || undefined), 20000, "Opening the camera");
  fillDevices().catch(() => {});
  return `${camStream.getVideoTracks()[0]?.label || "camera"} · ${view.W}×${view.H}`;
}
async function startMic() {
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  const id = $("micDev").value || cfg.micDevice || undefined;
  micStream = await withTimeout(navigator.mediaDevices.getUserMedia({
    audio: { deviceId: id ? { exact: id } : undefined, channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: true, autoGainControl: false },
  }), 20000, "Opening the microphone");
  audio.attachMic(micStream);
  fillDevices().catch(() => {});
  return micStream.getAudioTracks()[0]?.label || "on";
}
async function startSound() {
  if (!audio.monitor.ctx) audio.begin(cfg);
  const msg = await audio.init();
  audio.setVoice(effectCfg(effect).voice);
  return msg;
}

/* tracking */
let handTracker = null, faceTracker = null;
async function startHands(stage) {
  const { tracker, where } = await createHandTracker(cfg.gpu, stage);
  tracker.onResult(lm => { trackN.hands++; hands = readHands({ landmarks: lm }, view); });
  handTracker = tracker;
  return `running on ${where}`;
}
async function startFace(stage) {
  const { tracker, where } = await createFaceTracker(cfg.gpu, stage);
  tracker.onResult(lm => {
    trackN.face++;
    const fc = readFace({ faceLandmarks: lm }, view);
    const now = performance.now();
    if (fc) { face = fc; faceSeen = now; } else if (now - faceSeen > 300) face = null;
  });
  faceTracker = tracker;
  return `running on ${where}`;
}

/* person cut-out: started the first time an effect wants to replace the background */
let segTracker = null, segStarting = false;
function ensureSegmenter() {
  if (segTracker || segStarting || cutout.failed || SYSTEMS.camera.state !== "ok") return;
  segStarting = true;
  createSegmenter(cfg.gpu)
    .then(({ tracker, where }) => { tracker.onResult(m => cutout.setMask(m)); segTracker = tracker; bus.emit("cutout_ready", where); })
    .catch(e => { cutout.failed = true; bus.emit("cutout_failed", e.message || String(e)); })
    .finally(() => { segStarting = false; });
}
const wantsCutout = () => (inst.backdropAmount || 0) > 0.003;

/* virtual camera (desktop app only) */
async function startVcam(stage) {
  SYSTEMS.vcam.offMsg = !isDesktop ? "desktop app only" : isMac ? "not on Mac yet" : "turned off";
  if (!isDesktop || isMac || !cfg.vcam) { vcam.stop(); return "off"; }
  stage("checking…");
  const st = await withTimeout(vcam.status(), 8000, "Checking the virtual camera");
  if (!st.installed) {
    const err = new Error(st.detail || "not installed yet");
    err.action = { label: "Install", fn: installVcam };
    throw err;
  }
  if (!vcam.start()) {
    const err = new Error("couldn't start. Is another copy of CAMBOT open?");
    throw err;
  }
  return "on · pick “CAMBOT Camera” in your call app";
}
async function installVcam() {
  Object.assign(SYSTEMS.vcam, { state: "starting", msg: "waiting for Windows approval…", action: null });
  renderSys();
  const r = await vcam.install();
  bus.emit("vcam_install", r.ok ? "done" : r.detail);
  runSys("vcam");
}

/* devices */
async function fillDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const opts = (kind) => devs.filter(d => d.kind === kind && d.deviceId !== "communications");
  const fill = (sel, list, current, first) => {
    sel.innerHTML = (first || "") + list.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `Device ${i + 1}`)}</option>`).join("");
    if (current != null && [...sel.options].some(o => o.value === current)) sel.value = current;
  };
  fill($("camDev"), opts("videoinput").filter(d => !/CAMBOT Camera/i.test(d.label)), camStream?.getVideoTracks()[0]?.getSettings().deviceId);
  fill($("micDev"), opts("audioinput").filter(d => !CABLE_IN.test(d.label)), micStream?.getAudioTracks()[0]?.getSettings().deviceId);
  const outs = opts("audiooutput");
  fill($("monDev"), outs.filter(d => d.deviceId !== "default"), cfg.monitorDevice, `<option value="">System default</option>`);
  fill($("callDev"), outs.filter(d => d.deviceId !== "default"), cfg.callDevice, `<option value="">Off: don't send my voice</option>`);
  const cable = outs.find(d => CABLE_OUT.test(d.label));
  $("cableHint").innerHTML = isMac
    ? (cable
      ? (cfg.callDevice === cable.deviceId ? "Sending to BlackHole. In your call app, set the microphone to <b>BlackHole 2ch</b>." : "BlackHole found. Choose <b>BlackHole 2ch</b> above to send your voice.")
      : "Install BlackHole 2ch (free, existential.audio/blackhole) once, then restart CAMBOT.")
    : (cable
      ? (cfg.callDevice === cable.deviceId ? "Sending to VB-Cable. In your call app, set the microphone to <b>CABLE Output</b>." : "VB-Cable found. Choose <b>CABLE Input</b> above to send your voice.")
      : "Install VB-Cable (free, vb-audio.com/Cable) once, then restart CAMBOT. It shows up here as <b>CABLE Input</b>.");
  if (typeof AudioContext.prototype.setSinkId !== "function") {
    $("monDev").disabled = $("callDev").disabled = true;
  }
}
navigator.mediaDevices?.addEventListener?.("devicechange", () => fillDevices().catch(() => {}));

/* ---------------------------------------------------------------- effects */
let effect = null, inst = null, unsubs = [];
function useEffect(id) {
  if (inst) { try { inst.dispose && inst.dispose(); } catch (e) { console.warn(e); } }
  unsubs.forEach(u => u()); unsubs = [];
  effect = EFFECTS.find(e => e.id === id) || EFFECTS[0];
  cfg.effect = effect.id; save();
  const settings = effectCfg(effect);
  const kit = {
    settings, view, Holds,
    cutout: { get ready() { return cutout.ready; }, get failed() { return cutout.failed; } },
    emit: (name, data) => bus.emit(name, data),
    on: (name, fn) => unsubs.push(bus.on(name, fn)),
    sfx: { play: (name, ...args) => audio.play(name, ...args), loop: kind => audio.loop(kind) },
  };
  inst = effect.create(kit);
  audio.setVoice(settings.voice);
  renderEffectPanel();
  bus.emit("effect", effect.name);
}

/* ---------------------------------------------------------------- frame loop */
let frozenHands = [];
let lastFrame = performance.now(), lastVideoTime = -1, hands = [], face = null, faceSeen = -1e9, grabbing = false;
let fpsAcc = 0, fpsN = 0, lastUI = 0;
const trackN = { hands: 0, face: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    const r = n => Math.round(n / fpsAcc);
    $("fpsChip").textContent = `${r(fpsN)} fps · hands ${r(trackN.hands)} · face ${r(trackN.face)}`;
    $("fpsChip").title = "Drawing rate, then how many times a second each tracker updates";
    fpsAcc = 0; fpsN = 0; trackN.hands = 0; trackN.face = 0;
  }

  feedTrackers();

  const f = { t: now, dt, hands, face, W: view.W, H: view.H };
  // While a shortcut gesture is being held, the mode keeps seeing the hands from just before it,
  // so making the gesture doesn't also set off (or cancel) the mode's own gestures.
  let busy = false;
  if (cfg.shortcuts) { try { busy = shortcuts.update(f); } catch (e) { console.error(e); } }
  if (!busy) frozenHands = hands;
  try { inst.update(busy ? { ...f, hands: frozenHands } : f); } catch (e) { console.error(e); }
  render(f);
  audio.setVoiceLevel(cfg.voiceForce ? 1 : (inst.voice || 0));
  // Effect text goes on its own layer, so it reads correctly on screen and in the (un-mirrored) call picture.
  let labels = [];
  try { labels = (inst.labels && inst.labels(f)) || []; } catch (e) { console.error(e); }
  labels = labels.map(l => ({ ...l, ...shortcuts.mapPoint(l, f.W, f.H) }));
  tctx.clearRect(0, 0, f.W, f.H);
  drawLabels(tctx, labels);
  if (vcam.running) vcam.send(out, now, cfg.mirror, labels);
  if (now - lastUI > 100) { lastUI = now; updateUI(); }
}
// Hand each new camera frame to whichever trackers are free. They run in workers and report back
// when done; drawing never waits for them. A tracker still busy with the last frame skips this one.
function feedTrackers() {
  if (grabbing || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  const needSeg = wantsCutout();
  if (needSeg) ensureSegmenter();
  const free = [handTracker, faceTracker, needSeg ? segTracker : null].filter(t => t && !t.busy);
  if (!free.length) return;
  lastVideoTime = video.currentTime;
  grabbing = true;
  const t = ts();
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  // One shrunken copy of the frame per size the free trackers want, then a copy each for the rest.
  const widths = [...new Set(free.map(tr => tr.inputW || 640))];
  Promise.all(widths.map(w => createImageBitmap(video, { resizeWidth: w, resizeHeight: Math.round(w * vh / vw / 2) * 2, resizeQuality: "low" })))
    .then(async firsts => {
      const used = new Set();
      for (const tr of free) {
        const src = firsts[widths.indexOf(tr.inputW || 640)];
        tr.send(used.has(src) ? await createImageBitmap(src) : src, t);
        used.add(src);
      }
    })
    .catch(e => console.warn(e))
    .finally(() => { grabbing = false; });
}
let lastTs = 0;
const ts = () => { let n = performance.now(); if (n <= lastTs) n = lastTs + 1; lastTs = n; return n; };

function render(f) {
  const { W, H } = f;
  const g = (inst.grade && inst.grade(f)) || {};
  octx.save();
  octx.globalCompositeOperation = "source-over";
  octx.fillStyle = "#000"; octx.fillRect(0, 0, W, H);
  if (g.shake) octx.translate(rand(-1, 1) * g.shake, rand(-1, 1) * g.shake);
  const dk = g.darken || 0, ds = g.desaturate || 0, ct = g.contrast || 0;
  if (dk || ds || ct) octx.filter = `brightness(${(1 - dk).toFixed(3)}) saturate(${(1 - ds).toFixed(3)}) contrast(${(1 + ct).toFixed(3)})`;
  if (video.readyState >= 2) {
    if (cfg.mirror) { octx.save(); octx.translate(W, 0); octx.scale(-1, 1); octx.drawImage(video, 0, 0, W, H); octx.restore(); }
    else octx.drawImage(video, 0, 0, W, H);
  }
  octx.filter = "none";
  if (g.tint && g.tintAmount > 0.01) {
    octx.globalCompositeOperation = "soft-light";
    octx.fillStyle = `rgba(${g.tint.join(",")},${g.tintAmount})`;
    octx.fillRect(-40, -40, W + 80, H + 80);
  }
  // Effects can replace the room behind you (e.g. Star Map's night sky).
  const bd = inst.backdrop ? (inst.backdropAmount || 0) : 0;
  if (bd > 0.003) {
    try { cutout.replaceBackground(octx, f, bd, (c, fr) => inst.backdrop(c, fr), view.mirror); } catch (e) { console.error(e); }
  }
  octx.save();
  try { inst.draw(octx, f); } catch (e) { console.error(e); }
  octx.restore();
  octx.globalCompositeOperation = "source-over";
  vignette(octx, W, H, g.vignette || 0);
  octx.restore();
  try { shortcuts.post(octx, f); } catch (e) { console.error(e); }

  vctx.clearRect(0, 0, W, H);
  if (!document.body.classList.contains("clean")) {
    try { inst.overlay && inst.overlay(vctx, f); } catch (e) { console.error(e); }
    if (cfg.shortcuts) shortcuts.overlay(vctx);
    if (cfg.debug) drawDebug(f);
  }
}

const shapeName = h => h.thumbsUp ? "thumbs up" : h.peace ? "peace" : h.L ? "L" : h.point ? "point"
  : h.upright ? "open, upright" : h.fist ? "fist" : h.open ? "open" : h.pinch ? "pinch" : "partly closed";

function drawDebug(f) {
  vctx.save();
  vctx.lineWidth = 2;
  vctx.font = "600 16px 'IBM Plex Mono', monospace";
  for (const h of f.hands) {
    vctx.strokeStyle = vctx.fillStyle = h.fist ? "#ffb35c" : h.open ? "#7dffb2" : h.pinch ? "#ff7de0" : "#d6dde8";
    vctx.beginPath();
    for (const [a, b] of HAND_BONES) { vctx.moveTo(h.P[a].x, h.P[a].y); vctx.lineTo(h.P[b].x, h.P[b].y); }
    vctx.stroke();
    vctx.fillText(shapeName(h).toUpperCase(), h.P[0].x - 24, h.P[0].y + 28);
  }
  if (f.face) {
    vctx.strokeStyle = "#8fd3ff";
    for (const e of f.face.eyes) { vctx.beginPath(); vctx.arc(e.c.x, e.c.y, e.r, 0, Math.PI * 2); vctx.stroke(); }
  }
  vctx.restore();
}

/* ---------------------------------------------------------------- panel */
function renderEffectPanel() {
  $("effectPicker").innerHTML = EFFECTS.map((e, i) =>
    `<button class="fx ${e.id === effect.id ? "on" : ""}" data-id="${e.id}"><b>${i + 1}</b>${escapeHtml(e.name)}</button>`).join("");
  $("effectBlurb").textContent = effect.blurb || "";
  $("seq").innerHTML = effect.steps.map((s, i) =>
    `<li data-s="${s.id}"><b>${String(i + 1).padStart(2, "0")}</b><span>${escapeHtml(s.label)}</span><em></em></li>`).join("");

  const S = effectCfg(effect);
  $("fxSettings").innerHTML = (effect.settings || []).map(s => {
    const id = `fx_${s.key}`;
    if (s.type === "range") return `<div class="row"><label for="${id}">${escapeHtml(s.label)}</label><input type="range" id="${id}" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${S[s.key]}"><output id="${id}_v">${escapeHtml(s.format ? s.format(S[s.key]) : S[s.key])}</output></div>`;
    if (s.type === "select") return `<div class="row two"><label for="${id}">${escapeHtml(s.label)}</label><select id="${id}" data-key="${s.key}">${s.options.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(S[s.key]) ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></div>`;
    if (s.type === "toggle") return `<label class="toggle"><input type="checkbox" id="${id}" data-key="${s.key}" ${S[s.key] ? "checked" : ""}> ${escapeHtml(s.label)}</label>`;
    return "";
  }).join("");

  $("pitch").value = S.voice.pitch;
  $("electric").value = S.voice.electric;
  $("mix").value = S.voice.mix;
  showVoiceValues();
}

$("effectPicker").addEventListener("click", e => {
  const b = e.target.closest("button[data-id]");
  if (b) useEffect(b.dataset.id);
});
$("fxSettings").addEventListener("input", e => {
  const key = e.target.dataset.key;
  if (!key) return;
  const def = effect.settings.find(s => s.key === key);
  const S = effectCfg(effect);
  let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  if (def.type === "range" || (def.type === "select" && typeof def.default === "number")) v = parseFloat(v);
  S[key] = v; save();
  const outEl = $(`fx_${key}_v`);
  if (outEl) outEl.textContent = def.format ? def.format(v) : v;
});
$("fxReset").addEventListener("click", () => { resetEffectCfg(effect); useEffect(effect.id); });

function showVoiceValues() {
  const S = effectCfg(effect);
  $("pitchV").textContent = `${(12 * Math.log2(S.voice.pitch)).toFixed(1)} st`;
  $("electricV").textContent = `${Math.round(S.voice.electric * 100)}%`;
  const m = Math.round(S.voice.mix * 100);
  $("mixV").textContent = m >= 99 ? "All effect" : m <= 1 ? "All natural" : `${m}% effect`;
}
for (const key of ["pitch", "electric", "mix"]) {
  $(key).addEventListener("input", e => {
    const S = effectCfg(effect);
    S.voice[key] = parseFloat(e.target.value); save();
    audio.setVoice(S.voice);
    showVoiceValues();
  });
}

function updateUI() {
  const idx = effect.steps.findIndex(s => s.id === inst.step);
  document.querySelectorAll("#seq li").forEach((li, i) => {
    li.classList.toggle("active", i === idx);
    li.classList.toggle("done", i < idx);
    li.querySelector("em").textContent = i === idx && inst.progress > 0 ? `${Math.round(inst.progress * 100)}%` : "";
  });
  $("stateChip").textContent = [`${effect.name} · ${inst.step}`, ...shortcuts.active, ...(cfg.voiceForce ? ["Voice effect forced on"] : [])].join(" · ");
  $("stateChip").classList.toggle("on", idx > 0);

  const camS = SYSTEMS.camera.state, handS = SYSTEMS.hands.state;
  const txt = camS !== "ok" ? (camS === "error" ? "Camera didn't start. See System in the panel" : "Starting camera…")
    : handS === "ok" ? inst.coach
    : handS === "error" ? "Hand tracking didn't start. Press Space to preview the effect"
    : "Starting hand tracking…";
  $("coach").hidden = !txt;
  $("coachText").textContent = txt || "";
  $("coachBar").style.width = `${(inst.progress || 0) * 100}%`;

  for (let i = 0; i < 2; i++) {
    const h = hands[i];
    $("h" + i).textContent = handS !== "ok" ? (handS === "error" ? "tracking unavailable" : "starting…")
      : h ? `${shapeName(h)} · height ${Math.round((1 - h.y01) * 100)}%` : "no hand";
  }
  const faceS = SYSTEMS.face.state;
  $("faceV").textContent = faceS === "error" ? "unavailable" : faceS !== "ok" ? "starting…"
    : face ? `eyes ${Math.round(face.eyes[0].open * 100)}% / ${Math.round(face.eyes[1].open * 100)}% open · mouth ${Math.round(face.mouthOpen * 100)}%` : "not found";
  $("micMeter").style.width = `${Math.min(1, audio.micLevel() * 6) * 100}%`;
  $("voiceLevel").style.width = `${audio.level * 100}%`;
  if (vcam.running) $("vcamState").textContent = vcam.connected() ? "A call app is using CAMBOT Camera" : "Ready. No app is using it yet";
}

/* general toggles */
function bindCheck(id, key, after) {
  const el = $(id); el.checked = !!cfg[key];
  el.addEventListener("change", () => { cfg[key] = el.checked; save(); after && after(); });
}
function bindRange(id, key, fmt, after) {
  const el = $(id), outEl = $(id + "V");
  el.value = cfg[key];
  const show = () => { if (outEl) outEl.textContent = fmt(cfg[key]); };
  show();
  el.addEventListener("input", () => { cfg[key] = parseFloat(el.value); show(); save(); after && after(); });
}
bindCheck("mirror", "mirror");
bindCheck("debug", "debug");
bindCheck("shortcutsOn", "shortcuts", () => { if (!cfg.shortcuts) shortcuts.reset(); });
bindCheck("gpu", "gpu");
bindCheck("hearSfx", "hearSfx", () => audio.applySettings());
bindCheck("hearVoice", "hearVoice", () => { audio.applySettings(); $("fbWarn").hidden = !cfg.hearVoice; });
bindCheck("callSfx", "callSfx", () => audio.applySettings());
bindCheck("voiceForce", "voiceForce");
bindCheck("vcamOn", "vcam", () => runSys("vcam"));
bindRange("monitorVol", "monitorVol", v => `${Math.round(v * 100)}%`, () => audio.applySettings());
bindRange("sfxVol", "sfxVol", v => `${Math.round(v * 100)}%`, () => audio.applySettings());
$("fbWarn").hidden = !cfg.hearVoice;

$("monDev").addEventListener("change", async e => {
  cfg.monitorDevice = e.target.value; save();
  try { await audio.setMonitorDevice(cfg.monitorDevice); bus.emit("monitor_output", e.target.selectedOptions[0].textContent); }
  catch (err) { bus.emit("monitor_output_failed", err.message); }
});
$("callDev").addEventListener("change", async e => {
  cfg.callDevice = e.target.value; save();
  try { const r = await audio.setCallDevice(cfg.callDevice); bus.emit("call_output", r === "off" ? "off" : e.target.selectedOptions[0].textContent); }
  catch (err) { bus.emit("call_output_failed", err.message); }
  fillDevices().catch(() => {});
});
$("camDev").addEventListener("change", e => { cfg.camDevice = e.target.value; save(); runSys("camera"); });
$("micDev").addEventListener("change", e => { cfg.micDevice = e.target.value; save(); runSys("mic"); });

/* voice test */
$("recBtn").addEventListener("click", async () => {
  const b = $("recBtn");
  b.disabled = true; $("playDry").disabled = $("playFx").disabled = true;
  try {
    const secs = await audio.recordTest(5, n => { b.textContent = `Recording… ${n}`; });
    bus.emit("voice_test_recorded", `${secs.toFixed(1)}s`);
    $("playDry").disabled = $("playFx").disabled = false;
    $("testNote").textContent = "Compare the two. Headphones give the truest picture.";
  } catch (err) {
    $("testNote").textContent = `Couldn't record: ${err.message}`;
  } finally {
    b.disabled = false; b.textContent = "Record 5 seconds";
  }
});
$("playDry").addEventListener("click", () => audio.playTest(false));
$("playFx").addEventListener("click", () => audio.playTest(true));

/* diagnostics */
$("copyDiag").addEventListener("click", async () => {
  const lines = [
    "CAMBOT diagnostics",
    `App: ${isDesktop ? "desktop " + (window.cambot.version || "") : "browser"} · ${navigator.userAgent}`,
    `Effect: ${effect.name} · step ${inst.step}`,
    ...Object.values(SYSTEMS).map(s => `${s.label}: ${s.state} · ${s.msg}`),
    "Event log:",
    ...[...$("log").children].reverse().map(li => li.textContent),
  ].join("\n");
  try { await navigator.clipboard.writeText(lines); $("copyDiag").textContent = "Copied"; }
  catch { $("copyDiag").textContent = "Copy blocked"; console.log(lines); }
  setTimeout(() => { $("copyDiag").textContent = "Copy diagnostics"; }, 2000);
});

/* keys */
const toggleClean = () => document.body.classList.toggle("clean");
$("cleanBtn").addEventListener("click", toggleClean);
$("testBtn").addEventListener("click", () => inst.trigger && inst.trigger(currentFrame()));
const currentFrame = () => ({ t: performance.now(), dt: 0, hands, face, W: view.W, H: view.H });
window.addEventListener("keydown", e => {
  if (e.target.matches("input, select, textarea") && e.key !== " ") return;
  const k = e.key.toLowerCase();
  if (k === "h") toggleClean();
  else if (k === "f") { (document.fullscreenElement ? document.exitFullscreen() : $("stage").requestFullscreen()).catch(() => {}); }
  else if (k === " ") { e.preventDefault(); inst.trigger && inst.trigger(currentFrame()); }
  else if (k === "p") { inst.reset && inst.reset(currentFrame()); shortcuts.reset(); }
  else if (k === "z") shortcuts.trigger("zoom", currentFrame());
  else if (k === "m") shortcuts.trigger("mirror", currentFrame());
  else if (k === "c") shortcuts.trigger("confetti", currentFrame());
  else if (k === "g") shortcuts.trigger("glitch", currentFrame());
  else if (k === "d") { cfg.debug = !cfg.debug; $("debug").checked = cfg.debug; save(); }
  else if (/^[1-9]$/.test(k) && EFFECTS[+k - 1]) useEffect(EFFECTS[+k - 1].id);
});

/* ---------------------------------------------------------------- gesture shortcuts */
const modeIsIdle = () => (effect.idleSteps || [effect.steps[0].id]).includes(inst.step);
const shortcuts = createShortcuts({
  play: (name, ...args) => audio.play(name, ...args),
  emit: (name, data) => bus.emit(name, data),
  switchTo: id => useEffect(id),
  currentMode: () => effect.id,
  modeIsIdle,
});
$("shortcutList").innerHTML = SHORTCUTS.map(s => `<li><b>${escapeHtml(s.name)}</b><span>${escapeHtml(s.how)}</span></li>`).join("");

/* ---------------------------------------------------------------- start */
if (isMac) {
  $("vcamOn").disabled = true;
  $("vcamState").textContent = "The Mac app can't act as a camera in call apps yet. See the README for options.";
}
useEffect(cfg.effect);
renderSys();
requestAnimationFrame(frame);

$("startBtn").addEventListener("click", () => {
  audio.begin(cfg); // inside the click, so sound is allowed
  $("gate").hidden = true;
  runSys("camera").then(() => runSys("vcam"));
  runSys("mic");
  runSys("sound").then(autoPickCable);
  runSys("hands").then(() => runSys("face"));
});

// First time VB-Cable is present, send the voice there automatically.
async function autoPickCable() {
  if (cfg.callDevice || cfg.cableOffered || !sysOk("sound")) return;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const cable = devs.find(d => d.kind === "audiooutput" && CABLE_OUT.test(d.label));
    if (!cable) return;
    cfg.cableOffered = true; cfg.callDevice = cable.deviceId; save();
    await audio.setCallDevice(cable.deviceId);
    bus.emit("call_output", `${isMac ? "BlackHole" : "VB-Cable"} found and selected`);
    fillDevices();
  } catch (e) { console.warn(e); }
}

/* updates (desktop app): show a bar when a new version has downloaded */
if (isDesktop && window.cambot.updates) {
  window.cambot.updates.onState(({ state, detail }) => {
    if (state === "ready" || state === "available") {
      $("updateMsg").textContent = state === "ready" ? `CAMBOT ${detail} is ready.` : `CAMBOT ${detail} is out.`;
      $("updateBtn").textContent = state === "ready" ? "Restart to update" : "Download";
      $("updateBar").hidden = false;
    }
    if (state === "ready" || state === "available" || state === "error") bus.emit(`update_${state}`, detail);
  });
  $("updateBtn").addEventListener("click", () => {
    if (isMac) { window.cambot.updates.install(); return; }   // opens the download page
    $("updateBtn").disabled = true; $("updateMsg").textContent = "Restarting…";
    window.cambot.updates.install();
  });
}

if (isDesktop && window.cambot.autoStart) $("startBtn").click();
