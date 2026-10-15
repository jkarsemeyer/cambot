// Voice pitch shifter (runs on the audio thread).
//
// Reads your voice back from a short delay line at a different speed: slower reads lower the pitch,
// faster reads raise it. Every so often the read point has to jump back (or forward) to stay near
// "now". A plain shifter jumps a fixed distance and cross-fades, and because the two waveforms are
// out of step they partly cancel, which you hear as a fluttery, choppy sound.
//
// This one searches for the jump distance where the waveform lines up best with what's playing
// (a waveform-similarity splice), so the cross-fade joins two matching cycles of your voice and
// stays smooth. Typical delay is about 10-20 ms.

const MIN = 288;      // smallest delay, samples (6 ms at 48 kHz)
const JUMP = 432;     // shortest splice distance (9 ms)
const SEARCH = 720;   // how far beyond that to look for a match: one cycle of a voice down to ~67 Hz
const XF = 288;       // cross-fade length (6 ms)
const CL = 256;       // how many samples to compare when matching

class PitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: "ratio", defaultValue: 1, minValue: 0.5, maxValue: 1.6 }]; }

  constructor() {
    super();
    this.N = 8192; this.mask = this.N - 1;
    this.buf = new Float32Array(this.N);
    this.w = 0;
    this.d = MIN + JUMP;      // current delay (fractional)
    this.dOld = 0;            // delay of the outgoing read point during a cross-fade
    this.xf = 0;              // cross-fade samples remaining
  }

  read(d) {
    const pos = this.w - d, i = Math.floor(pos), f = pos - i, m = this.mask;
    return this.buf[i & m] * (1 - f) + this.buf[(i + 1) & m] * f;
  }

  // Jump the read point by the distance (JUMP..JUMP+SEARCH) whose waveform best matches the current one.
  splice(dir) {
    const b = this.buf, m = this.mask, w = this.w;
    const d0 = Math.round(this.d);
    let best = -Infinity, bestS = JUMP;
    for (let s = JUMP; s <= JUMP + SEARCH; s++) {
      const dn = d0 + dir * s;
      const L = Math.min(CL, dn - 2);
      let c = 0, e = 0;
      for (let k = 0; k < L; k += 2) {
        const x = b[(w - d0 + k) & m], y = b[(w - dn + k) & m];
        c += x * y; e += y * y;
      }
      const score = c / Math.sqrt(e + 1e-9);
      if (score > best) { best = score; bestS = s; }
    }
    this.dOld = this.d;
    this.d = this.d + dir * bestS;
    this.xf = XF;
  }

  process(inputs, outputs, params) {
    const inp = inputs[0] && inputs[0][0];
    const out = outputs[0][0];
    if (!out) return true;
    const rp = params.ratio;
    for (let i = 0; i < out.length; i++) {
      this.buf[this.w] = inp ? inp[i] : 0;
      const ratio = Math.min(1.6, Math.max(0.5, rp.length > 1 ? rp[i] : rp[0]));
      const step = 1 - ratio;
      this.d += step;
      if (this.xf === 0) {
        if (step > 0 && this.d > MIN + JUMP + SEARCH) this.splice(-1);
        else if (step < 0 && this.d < MIN) this.splice(1);
      }
      let y = this.read(this.d);
      if (this.xf > 0) {
        this.dOld += step;
        const g = this.xf / XF;               // 1 → 0 across the fade
        const gOld = Math.sin(g * Math.PI / 2) ** 2, gNew = 1 - gOld;
        y = y * gNew + this.read(this.dOld) * gOld;
        this.xf--;
      }
      out[i] = y;
      this.w = (this.w + 1) & this.mask;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor("pitch-shift", PitchShift);
