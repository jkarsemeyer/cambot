class PitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 0.72, minValue: 0.25, maxValue: 2 }]; }
  constructor() { super(); this.size = 8192; this.buf = new Float32Array(this.size); this.w = 0; this.phase = 0; this.win = 1200; } // win: grain length in samples (25 ms at 48 kHz); shorter means less delay
  read(pos) { pos = ((pos % this.size) + this.size) % this.size; const i = Math.floor(pos), f = pos - i; return this.buf[i] * (1 - f) + this.buf[(i + 1) % this.size] * f; }
  process(inputs, outputs, params) {
    const inp = inputs[0] && inputs[0][0];
    const out = outputs[0][0];
    if (!out) return true;
    const ratio = params.ratio[0];
    for (let i = 0; i < out.length; i++) {
      this.buf[this.w] = inp ? inp[i] : 0;
      this.phase += (1 - ratio) / this.win;
      this.phase -= Math.floor(this.phase);
      const p1 = this.phase, p2 = (this.phase + 0.5) % 1;
      const g1 = Math.sin(Math.PI * p1) ** 2, g2 = Math.sin(Math.PI * p2) ** 2;
      out[i] = this.read(this.w - 1 - p1 * this.win) * g1 + this.read(this.w - 1 - p2 * this.win) * g2;
      this.w = (this.w + 1) % this.size;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('pitch-shift', PitchShift);
