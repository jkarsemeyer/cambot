// Small shared helpers.

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const lerp = (a, b, t) => a + (b - a) * t;

// Move `cur` toward `target` at separate up/down speeds (units per second).
export const approach = (cur, target, upRate, downRate, dt) =>
  cur < target ? Math.min(target, cur + upRate * dt) : Math.max(target, cur - downRate * dt);

export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function withTimeout(p, ms, what = "This step") {
  let timer;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} took longer than ${ms / 1000}s`)), ms); }),
  ]);
}

// "Has this been true for N ms?" timers, keyed by name. Effects use one per gesture.
export class Holds {
  constructor() { this.since = {}; }
  held(key, cond, ms, now) {
    if (cond) { if (this.since[key] == null) this.since[key] = now; return now - this.since[key] >= ms; }
    this.since[key] = null; return false;
  }
  frac(key, ms, now) { return this.since[key] == null ? 0 : clamp((now - this.since[key]) / ms); }
  clear(key) { if (key) this.since[key] = null; else this.since = {}; }
}

export const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
