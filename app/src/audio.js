// Sound: generated sound effects, the voice effect, and two outputs.
//   monitor  what you hear on this computer (headphones or speakers)
//   call     what goes into your call app, through a virtual cable such as VB-Cable
// Each output runs its own copy of the voice effect and sound effects, so either can use any device.

import { withTimeout, rand, clamp } from "./util.js";
import { bus } from "./bus.js";

const workletLoads = new WeakMap();

/* ---------------------------------------------------------------- pitch shifters */

// Preferred: runs on the audio thread (pitch-worklet.js).
async function makeWorkletPitch(ac) {
  if (!workletLoads.has(ac)) {
    workletLoads.set(ac, withTimeout(ac.audioWorklet.addModule(new URL("pitch-worklet.js", document.baseURI).href), 4000, "Loading the voice processor"));
  }
  await workletLoads.get(ac);
  const node = new AudioWorkletNode(ac, "pitch-shift", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  return { input: node, output: node, kind: "worklet", setRatio: r => node.parameters.get("ratio").setTargetAtTime(r, ac.currentTime, 0.05) };
}

// Backup built from standard audio nodes: two delay lines whose delay ramps, cross-faded.
function makeNativePitch(ac) {
  const input = ac.createGain(), output = ac.createGain();
  const win = 0.05, sr = ac.sampleRate, n = sr;
  const ramp = ac.createBuffer(1, n, sr), fade = ac.createBuffer(1, n, sr);
  const r = ramp.getChannelData(0), f = fade.getChannelData(0);
  for (let i = 0; i < n; i++) { const p = i / n; r[i] = p; f[i] = Math.sin(Math.PI * p) ** 2; }
  const taps = [0, 0.5].map(off => {
    const d = ac.createDelay(1); d.delayTime.value = 0;
    const rs = ac.createBufferSource(); rs.buffer = ramp; rs.loop = true;
    const depth = ac.createGain(); depth.gain.value = win;
    rs.connect(depth).connect(d.delayTime);
    const fs = ac.createBufferSource(); fs.buffer = fade; fs.loop = true;
    const vca = ac.createGain(); vca.gain.value = 0; fs.connect(vca.gain);
    input.connect(d).connect(vca).connect(output);
    return { d, rs, fs, depth, off };
  });
  const start = ac.currentTime + 0.05;
  taps.forEach(tp => { tp.rs.start(start, tp.off); tp.fs.start(start, tp.off); });
  return {
    input, output, kind: "backup",
    setRatio(ratio) {
      const t = ac.currentTime, rate = Math.max(0.02, Math.abs(1 - ratio)) / win, down = ratio <= 1;
      taps.forEach(tp => {
        tp.rs.playbackRate.setValueAtTime(rate, t);
        tp.fs.playbackRate.setValueAtTime(rate, t);
        tp.depth.gain.setValueAtTime(down ? win : -win, t);
        tp.d.delayTime.setValueAtTime(down ? 0 : win, t);
      });
    },
  };
}

/* ---------------------------------------------------------------- voice effect chain
   mic -> dry ------------------------------------------------------------> out
       -> pitch -> drive -> (direct + ring modulator "electric") -> EQ -> slap echo -> wet -> out
   setLevel(0) is your normal voice, setLevel(1) is fully transformed. */
async function makeVoiceChain(ac) {
  let pitch;
  try { pitch = await makeWorkletPitch(ac); }
  catch (e) { pitch = makeNativePitch(ac); bus.emit("voice_backup_processor", e.message || String(e)); }

  const input = ac.createGain(), output = ac.createGain();
  const dry = ac.createGain(), wet = ac.createGain(); wet.gain.value = 0;
  input.connect(dry).connect(output);
  input.connect(pitch.input);

  const shaper = ac.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(6 * x) / Math.tanh(6); }
  shaper.curve = curve; shaper.oversample = "2x";
  pitch.output.connect(shaper);

  const ring = ac.createGain(); ring.gain.value = 0;
  const ringOsc = ac.createOscillator(); ringOsc.frequency.value = 46; ringOsc.connect(ring.gain); ringOsc.start();
  const ringAmt = ac.createGain(), direct = ac.createGain();
  shaper.connect(ring); ring.connect(ringAmt);
  shaper.connect(direct);
  const mix = ac.createGain(); ringAmt.connect(mix); direct.connect(mix);

  const shelf = ac.createBiquadFilter(); shelf.type = "lowshelf"; shelf.frequency.value = 180; shelf.gain.value = 6;
  const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 70;
  mix.connect(shelf).connect(hp);
  const echo = ac.createDelay(0.5); echo.delayTime.value = 0.085;
  const fb = ac.createGain(); fb.gain.value = 0.25;
  const echoOut = ac.createGain(); echoOut.gain.value = 0.35;
  hp.connect(echo); echo.connect(fb).connect(echo); echo.connect(echoOut);
  hp.connect(wet); echoOut.connect(wet);
  wet.connect(output);

  return {
    input, output, kind: pitch.kind,
    setParams({ pitch: ratio = 1, electric = 0 }) {
      const t = ac.currentTime;
      pitch.setRatio(clamp(ratio, 0.4, 1.6));
      ringAmt.gain.setTargetAtTime(electric * 0.9, t, 0.05);
      direct.gain.setTargetAtTime(1 - electric * 0.55, t, 0.05);
    },
    setLevel(level) {
      const t = ac.currentTime;
      dry.gain.setTargetAtTime(1 - level * 0.92, t, 0.04);
      wet.gain.setTargetAtTime(level * 1.1, t, 0.04);
      if (level > 0.01) ringOsc.frequency.setTargetAtTime(40 + Math.random() * 14, t, 0.1);
    },
  };
}

/* ---------------------------------------------------------------- one output device */
class Output {
  constructor(name) { this.name = name; this.ctx = null; this.ready = false; this.micSrc = null; }

  // Must be called during a click so the browser lets it play sound.
  create(sinkId) {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx.resume().catch(() => {});
    this.sinkId = sinkId || "";
  }

  async build() {
    const ac = this.ctx;
    if (this.sinkId) await this.setSink(this.sinkId);
    this.master = ac.createGain(); this.master.connect(ac.destination);
    this.sfx = ac.createGain(); this.sfx.connect(this.master);
    this.voice = ac.createGain(); this.voice.gain.value = 0; this.voice.connect(this.master);
    const len = ac.sampleRate * 3;
    this.noise = ac.createBuffer(1, len, ac.sampleRate);
    this.brown = ac.createBuffer(1, len, ac.sampleRate);
    const n = this.noise.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { n[i] = Math.random() * 2 - 1; last = (last + 0.02 * n[i]) / 1.02; b[i] = last * 3.5; }
    this.chain = await makeVoiceChain(ac);
    this.chain.output.connect(this.voice);
    await withTimeout(ac.resume(), 3000, "Starting sound");
    this.ready = true;
  }

  async setSink(id) {
    if (typeof this.ctx.setSinkId !== "function") throw new Error("This browser can't choose an output device");
    await withTimeout(this.ctx.setSinkId(id || ""), 5000, "Switching the output device");
    this.sinkId = id || "";
  }

  attachMic(stream) {
    if (!this.ready || !stream) return;
    if (this.micSrc) this.micSrc.disconnect();
    this.micSrc = this.ctx.createMediaStreamSource(stream);
    this.micSrc.connect(this.chain.input);
  }

  close() {
    this.ready = false;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  gain(node, v) { if (this.ready) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  /* helpers */
  src(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; return s; }
  filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  /* one-shot sounds */
  thunder() {
    const ac = this.ctx, t = ac.currentTime;
    const n1 = this.src(this.noise), hp = this.filt("highpass", 1400), g1 = ac.createGain();
    g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(1, t + 0.004); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n1.connect(hp).connect(g1).connect(this.sfx); n1.start(t, rand(0, 2)); n1.stop(t + 0.4);
    for (let k = 0; k < 7; k++) this.zap(0.5, rand(0.02, 0.06), t + 0.03 + Math.random() * 0.35);
    const n2 = this.src(this.brown), lp = this.filt("lowpass", 500), g2 = ac.createGain();
    lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(60, t + 3);
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(1.4, t + 0.1); g2.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    n2.connect(lp).connect(g2).connect(this.sfx); n2.start(t, rand(0, 0.5)); n2.stop(t + 3.3);
    const o = ac.createOscillator(), g3 = ac.createGain();
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    g3.gain.setValueAtTime(0.9, t); g3.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g3).connect(this.sfx); o.start(t); o.stop(t + 0.85);
  }
  zap(vol = 0.3, dur = 0.05, at) {
    const t = at ?? this.ctx.currentTime;
    const s = this.src(this.noise), bp = this.filt("bandpass", rand(1500, 6500), 3), g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(bp).connect(g).connect(this.sfx); s.start(t, rand(0, 2.5)); s.stop(t + dur + 0.02);
  }
  whoosh(vol = 0.6, dur = 0.7) {
    const ac = this.ctx, t = ac.currentTime;
    const s = this.src(this.noise), bp = this.filt("bandpass", 300, 1.2), g = ac.createGain();
    bp.frequency.setValueAtTime(250, t); bp.frequency.exponentialRampToValueAtTime(2500, t + dur * 0.6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(bp).connect(g).connect(this.sfx); s.start(t, rand(0, 2)); s.stop(t + dur + 0.05);
    const o = ac.createOscillator(), og = ac.createGain();
    o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(140, t + dur * 0.5);
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(vol * 0.6, t + 0.08); og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(og).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  hiss(vol = 0.4, dur = 0.8) {
    const ac = this.ctx, t = ac.currentTime;
    const s = this.src(this.noise), hp = this.filt("highpass", 3000), g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(hp).connect(g).connect(this.sfx); s.start(t, rand(0, 2)); s.stop(t + dur + 0.05);
  }
  powerDown() {
    const ac = this.ctx, t = ac.currentTime, o = ac.createOscillator(), lp = this.filt("lowpass", 3000), g = ac.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(35, t + 1.1);
    lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(120, t + 1.1);
    g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    o.connect(lp).connect(g).connect(this.sfx); o.start(t); o.stop(t + 1.25);
  }
  blip(freq = 880, vol = 0.15) {
    const ac = this.ctx, t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.2);
  }

  /* continuous sounds: return { set(amount 0..1), stop() } */
  loop(kind) {
    const ac = this.ctx;
    const nodes = [];
    const started = [];
    const go = (...srcs) => { srcs.forEach(s => { s.start(); started.push(s); }); };
    const g = ac.createGain(); g.gain.value = 0; g.connect(this.sfx);
    let set;
    if (kind === "hum") {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(); o1.type = o2.type = "sawtooth";
      o1.frequency.value = 55; o2.frequency.value = 55.7;
      const lp = this.filt("lowpass", 200, 4); o1.connect(lp); o2.connect(lp); lp.connect(g);
      const n = this.src(this.noise); n.loop = true;
      const bp = this.filt("bandpass", 3200, 1.5), ng = ac.createGain(); ng.gain.value = 0;
      n.connect(bp).connect(ng).connect(this.sfx);
      nodes.push(ng); go(o1, o2, n);
      set = v => {
        const t = ac.currentTime;
        o1.frequency.setTargetAtTime(55 + v * 70, t, 0.05);
        o2.frequency.setTargetAtTime(55.7 + v * 71, t, 0.05);
        lp.frequency.setTargetAtTime(200 + v * 2200, t, 0.05);
        g.gain.setTargetAtTime(0.1 + v * 0.22, t, 0.05);
        ng.gain.setTargetAtTime(v * 0.12 * (Math.random() < 0.3 ? 2 : 0.3), t, 0.01);
      };
    } else if (kind === "drone") {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.frequency.value = 41; o2.type = "triangle"; o2.frequency.value = 82.4;
      o1.connect(g); o2.connect(g); go(o1, o2);
      set = v => g.gain.setTargetAtTime(v * 0.09, ac.currentTime, 0.3);
    } else if (kind === "fire") {
      const n = this.src(this.brown); n.loop = true;
      const lp = this.filt("lowpass", 350); n.connect(lp).connect(g);
      const c = this.src(this.noise); c.loop = true;
      const bp = this.filt("bandpass", 1800, 0.8), cg = ac.createGain(); cg.gain.value = 0;
      c.connect(bp).connect(cg).connect(this.sfx);
      nodes.push(cg); go(n, c);
      set = v => {
        const t = ac.currentTime;
        g.gain.setTargetAtTime(v * 0.35, t, 0.1);
        lp.frequency.setTargetAtTime(250 + v * 500, t, 0.1);
        cg.gain.setTargetAtTime(Math.random() < 0.18 ? v * rand(0.15, 0.4) : v * 0.02, t, 0.005);
      };
    } else {
      throw new Error(`Unknown sound loop "${kind}"`);
    }
    nodes.push(g);
    return {
      set,
      stop: () => {
        const t = ac.currentTime;
        nodes.forEach(nd => nd.gain.setTargetAtTime(0, t, 0.05));
        started.forEach(s => { try { s.stop(t + 0.4); } catch {} });
      },
    };
  }
}

/* ---------------------------------------------------------------- the engine effects talk to */
export const audio = {
  monitor: new Output("monitor"),
  call: new Output("call"),
  mic: null,
  params: { pitch: 1, electric: 0 },
  level: 0,
  testing: false,
  settings: null,
  analyser: null,

  outs() { return [this.monitor, this.call].filter(o => o.ready); },

  // Call inside the Start click.
  begin(settings) {
    this.settings = settings;
    this.monitor.create(settings.monitorDevice);
    if (settings.callDevice) this.call.create(settings.callDevice);
  },

  // Builds whatever begin() created. Monitor failing is an error; call failing is reported separately.
  async init() {
    await this.monitor.build();
    this.analyser = this.monitor.ctx.createAnalyser(); this.analyser.fftSize = 512; this.levelBuf = new Float32Array(512);
    this.applySettings();
    if (this.mic) this.attachMic(this.mic);
    if (this.call.ctx && !this.call.ready) {
      try { await this.call.build(); this.applySettings(); if (this.mic) this.call.attachMic(this.mic); }
      catch (e) { this.call.close(); bus.emit("call_output_failed", e.message || String(e)); }
    }
    return this.monitor.chain.kind === "worklet" ? "ready" : "ready (backup voice processor)";
  },

  attachMic(stream) {
    this.mic = stream;
    for (const o of this.outs()) o.attachMic(stream);
    if (this.analyser && stream) {
      if (this.micTap) this.micTap.disconnect();
      this.micTap = this.monitor.ctx.createMediaStreamSource(stream);
      this.micTap.connect(this.analyser);
    }
  },

  applySettings() {
    const s = this.settings;
    if (!s) return;
    const m = this.monitor, c = this.call;
    if (m.ready) {
      m.gain(m.master, s.monitorVol);
      m.gain(m.sfx, s.hearSfx ? s.sfxVol : 0);
      m.gain(m.voice, s.hearVoice && !this.testing ? 1 : 0);
    }
    if (c.ready) {
      c.gain(c.master, 1);
      c.gain(c.sfx, s.callSfx ? s.sfxVol : 0);
      c.gain(c.voice, 1);
    }
  },

  async setMonitorDevice(id) { if (this.monitor.ready) await this.monitor.setSink(id); },

  // Choosing "" turns the call output off. Must be called from a click or change event.
  async setCallDevice(id) {
    if (!id) { this.call.close(); return "off"; }
    if (this.call.ready) { await this.call.setSink(id); return "switched"; }
    this.call.create(id);
    await this.call.build();
    this.call.chain.setParams(this.params);
    this.applySettings();
    if (this.mic) this.call.attachMic(this.mic);
    return "on";
  },

  setVoice(params) {
    this.params = { ...this.params, ...params };
    for (const o of this.outs()) o.chain.setParams(this.params);
    if (this.previewChain) this.previewChain.setParams(this.params);
  },

  setVoiceLevel(level) {
    if (Math.abs(level - this.level) < 0.002 && level !== 0 && level !== 1) return;
    this.level = level;
    for (const o of this.outs()) o.chain.setLevel(level);
  },

  micLevel() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let s = 0; for (const v of this.levelBuf) s += v * v;
    return Math.sqrt(s / this.levelBuf.length);
  },

  /* sound effects, played on every active output */
  play(name, ...args) {
    for (const o of this.outs()) { try { o[name](...args); } catch (e) { console.warn(e); } }
  },
  loop(kind) {
    const parts = this.outs().map(o => o.loop(kind));
    return { set: v => parts.forEach(p => p.set(v)), stop: () => parts.forEach(p => p.stop()) };
  },

  /* voice test: record a few seconds, then play it back plain or with the effect, on the monitor output */
  test: { buffer: null, src: null },
  async recordTest(seconds, onTick) {
    if (!this.mic) throw new Error("The microphone isn't on");
    if (!this.monitor.ready) throw new Error("Sound isn't on");
    const rec = new MediaRecorder(this.mic);
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const stopped = new Promise(r => { rec.onstop = r; });
    rec.start();
    for (let i = seconds; i > 0; i--) { onTick && onTick(i); await new Promise(r => setTimeout(r, 1000)); }
    rec.stop();
    await stopped;
    const data = await new Blob(chunks).arrayBuffer();
    this.test.buffer = await this.monitor.ctx.decodeAudioData(data);
    return this.test.buffer.duration;
  },
  async playTest(withEffect) {
    const m = this.monitor;
    if (!this.test.buffer || !m.ready) return;
    this.stopTest();
    const src = m.ctx.createBufferSource(); src.buffer = this.test.buffer;
    if (withEffect) {
      if (!this.previewChain) {
        this.previewChain = await makeVoiceChain(m.ctx);
        this.previewChain.output.connect(m.master);
        this.previewChain.setLevel(1);
      }
      this.previewChain.setParams(this.params);
      src.connect(this.previewChain.input);
    } else {
      src.connect(m.master);
    }
    this.testing = true; this.applySettings();
    src.onended = () => { if (this.test.src === src) { this.test.src = null; this.testing = false; this.applySettings(); bus.emit("voice_test_ended"); } };
    src.start();
    this.test.src = src;
  },
  stopTest() {
    if (this.test.src) { try { this.test.src.stop(); } catch {} this.test.src = null; }
    this.testing = false; this.applySettings();
  },
};
