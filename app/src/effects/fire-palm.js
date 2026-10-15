// Fire Palm: show an open palm and it catches fire. Close your hand to put it out.
// Both palms burning sets your eyes and voice alight.

import { approach, rand } from "../util.js";
import { glowDot, Particles, drawEyes } from "../draw.js";

const COLORS = {
  fire:  { glow: [255, 120, 30],  core: [255, 230, 170], tint: [140, 50, 0] },
  blue:  { glow: [60, 140, 255],  core: [210, 240, 255], tint: [10, 40, 120] },
  witch: { glow: [80, 255, 120],  core: [220, 255, 220], tint: [10, 90, 30] },
};

export default {
  id: "fire-palm",
  name: "Fire Palm",
  blurb: "Open palm to catch fire, fist to put it out. Two flames light your eyes.",
  voice: { pitch: 0.82, electric: 0.08 },
  settings: [
    { key: "igniteMs", label: "Palm hold", type: "range", min: 150, max: 1500, step: 50, default: 400, format: v => `${v} ms` },
    { key: "size", label: "Flame size", type: "range", min: 0.5, max: 2, step: 0.05, default: 1, format: v => `${Math.round(v * 100)}%` },
    { key: "color", label: "Flame colour", type: "select", options: [["fire", "Fire"], ["blue", "Blue flame"], ["witch", "Witch green"]], default: "fire" },
  ],
  steps: [
    { id: "idle", label: "Show an open palm" },
    { id: "lit", label: "Burning (make a fist to put it out)" },
    { id: "inferno", label: "Both palms: eyes and voice" },
  ],

  create(kit) {
    const S = kit.settings;
    const holds = new kit.Holds();
    const flames = new Particles(900);
    const smoke = new Particles(200);
    const slots = [0, 1].map(() => ({ lit: false, heat: 0, lastSeen: 0, x: 0, y: 0, size: 90 }));
    let power = 0, fire = null, infernoOn = false, testUntil = 0;

    const anyLit = () => slots.some(s => s.lit);
    const colors = () => COLORS[S.color] || COLORS.fire;

    function ignite(slot, i) {
      slot.lit = true; slot.heat = 0.15;
      kit.sfx.play("whoosh", 0.6, 0.7);
      kit.emit("flame_ignite", i === 0 ? "left hand" : "right hand");
      if (!fire) { fire = kit.sfx.loop("fire"); }
    }
    function douse(slot, i, quiet) {
      if (!slot.lit) return;
      slot.lit = false;
      if (!quiet) {
        kit.sfx.play("hiss", 0.35, 0.9);
        for (let k = 0; k < 14; k++) smoke.emit(slot.x, slot.y - slot.size * 0.5, { angle: -Math.PI / 2, spread: 0.6, speed: [30, 90], gravity: -40, life: [0.8, 1.6], size: [2, 4], drag: 0.97 });
      }
      kit.emit("flame_out", i === 0 ? "left hand" : "right hand");
      if (!anyLit() && fire) { fire.stop(); fire = null; }
    }

    return {
      get step() { return infernoOn ? "inferno" : anyLit() ? "lit" : "idle"; },
      get progress() { return Math.max(...slots.map(s => s.heat)); },
      get coach() {
        if (infernoOn) return "Make fists to put the flames out";
        if (anyLit()) return slots.every(s => s.lit) ? "Hold both flames…" : "Open your other hand too";
        return "Show an open palm to the camera";
      },
      get voice() { return power; },

      update(f) {
        const { t, dt, hands } = f;
        slots.forEach((slot, i) => {
          const h = hands[i];
          if (h) {
            slot.lastSeen = t; slot.x = h.palm.x; slot.y = h.palm.y; slot.size = h.size; slot.hand = h;
            if (!slot.lit && holds.held(`open${i}`, h.open, S.igniteMs, t)) ignite(slot, i);
            else if (slot.lit && holds.held(`fist${i}`, h.fist, 150, t)) douse(slot, i, false);
          } else {
            slot.hand = null;
            holds.clear(`open${i}`); holds.clear(`fist${i}`);
            if (slot.lit && t - slot.lastSeen > 600) douse(slot, i, true);
          }
          slot.heat = approach(slot.heat, slot.lit ? ((h && h.open) || t < testUntil ? 1 : 0.6) : 0, 0.7, 3, dt);

          // flames rise from the palm and fingertips
          if (slot.heat > 0.02) {
            const sz = slot.size * S.size;
            const rate = slot.heat * 220 * S.size;
            const n = Math.floor(rate * dt + Math.random());
            for (let k = 0; k < n; k++) {
              const src = !slot.hand ? slot : Math.random() < 0.55 ? slot.hand.palm : slot.hand.P[[8, 12, 16, 20, 4][Math.floor(Math.random() * 5)]];
              flames.emit(src.x + rand(-0.25, 0.25) * sz, src.y + rand(-0.15, 0.15) * sz, {
                angle: -Math.PI / 2, spread: 0.35, speed: [sz * 1.2, sz * 3.2], gravity: -sz * 2.5,
                life: [0.3, 0.75], size: [sz * 0.07, sz * 0.16], drag: 0.97,
              });
            }
          }
        });

        const both = slots.every(s => s.lit && s.heat > 0.8);
        if (both && !infernoOn) { infernoOn = true; kit.emit("inferno"); kit.emit("eyes_ignite"); kit.emit("voice_on"); kit.sfx.play("whoosh", 0.8, 1.1); }
        if (!both && infernoOn && !slots.some(s => s.lit)) { infernoOn = false; kit.emit("inferno_out"); }
        if (infernoOn && !slots.every(s => s.lit)) { infernoOn = false; kit.emit("inferno_out"); }
        power = approach(power, infernoOn ? 1 : 0, 0.9, 1.2, dt);
        if (fire) fire.set(Math.min(1, slots.reduce((a, s) => a + s.heat, 0) * 0.6 + power * 0.3));
        flames.update(dt);
        smoke.update(dt);
      },

      grade() {
        const c = colors();
        const heat = Math.max(...slots.map(s => s.heat));
        return { darken: power * 0.25, desaturate: power * 0.2, contrast: heat * 0.08, tint: c.tint, tintAmount: heat * 0.18 + power * 0.25, vignette: power * 0.55, shake: 0 };
      },

      draw(ctx, f) {
        const c = colors();
        ctx.globalCompositeOperation = "source-over";
        smoke.draw(ctx, "smoke", c);
        ctx.globalCompositeOperation = "lighter";
        for (const s of slots) {
          if (s.heat < 0.02) continue;
          const flick = 0.8 + Math.random() * 0.2, sz = s.size * S.size;
          glowDot(ctx, s.x, s.y - sz * 0.3, sz * (2 + s.heat * 1.5), c.glow, 0.4 * s.heat * flick);
          // flame body: three stacked, flickering teardrops, hottest at the centre
          for (let k = 0; k < 3; k++) {
            const h = sz * (1.5 + s.heat * 1.5) * (1 - k * 0.28) * (0.88 + Math.random() * 0.24);
            const w = sz * (0.8 - k * 0.2);
            ctx.save();
            ctx.translate(s.x + Math.sin(f.t * 0.012 + k * 2) * sz * 0.06, s.y - h * 0.32);
            ctx.scale(w / h, 1);
            glowDot(ctx, 0, 0, h * 0.62, k === 2 ? c.core : c.glow, (0.3 + 0.18 * k) * s.heat * flick);
            ctx.restore();
          }
          glowDot(ctx, s.x, s.y, sz * 0.7, c.core, 0.55 * s.heat * flick);
        }
        flames.draw(ctx, "ember", c);
        drawEyes(ctx, f.face, power, c, 0.6);
      },

      overlay() {},

      trigger(f) {
        testUntil = f.t + 3500;
        slots.forEach((s, i) => { if (!s.lit) { if (!f.hands[i]) { s.x = f.W * (0.3 + 0.4 * i); s.y = f.H * 0.6; s.lastSeen = f.t + 3500; } ignite(s, i); s.heat = 1; } });
      },
      reset() { slots.forEach((s, i) => douse(s, i, false)); infernoOn = false; },
      dispose() { if (fire) fire.stop(); },
    };
  },
};
