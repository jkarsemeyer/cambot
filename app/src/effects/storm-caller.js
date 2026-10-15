// Storm Caller: raise your hands, make fists, lightning strikes, fists glow, then eyes and voice.

import { clamp, rand, approach } from "../util.js";
import { glowDot, boltPath, makeBolt, strokeBolt, Particles, drawEyes } from "../draw.js";

const COLORS = {
  storm: { glow: [120, 200, 255], core: [235, 248, 255], tint: [30, 70, 150] },
  void:  { glow: [190, 120, 255], core: [245, 235, 255], tint: [60, 20, 120] },
  ember: { glow: [255, 150, 60],  core: [255, 244, 225], tint: [130, 40, 10] },
};

export default {
  id: "storm-caller",
  name: "Storm Caller",
  blurb: "Fists up to call lightning. Your fists, eyes and voice charge up.",
  voice: { pitch: 0.72, electric: 0.45 },
  settings: [
    { key: "handsNeeded", label: "Hands needed", type: "select", options: [[1, "1"], [2, "2"]], default: 2 },
    { key: "holdMs", label: "Fist hold", type: "range", min: 200, max: 2000, step: 50, default: 700, format: v => `${v} ms` },
    { key: "upLine", label: "Hands-up line", type: "range", min: 0.25, max: 0.9, step: 0.01, default: 0.6, format: v => `${Math.round(v * 100)}%` },
    { key: "lingerMs", label: "Stay powered after fists drop", type: "range", min: 500, max: 10000, step: 250, default: 2500, format: v => `${(v / 1000).toFixed(1)} s` },
    { key: "fadeMs", label: "Eye fade-out", type: "range", min: 200, max: 4000, step: 100, default: 1200, format: v => `${(v / 1000).toFixed(1)} s` },
    { key: "color", label: "Energy colour", type: "select", options: [["storm", "Storm blue"], ["void", "Void violet"], ["ember", "Ember orange"]], default: "storm" },
  ],
  idleSteps: ["idle", "armed"],   // gesture shortcuts can switch modes from these steps
  steps: [
    { id: "idle", label: "Raise hands" },
    { id: "armed", label: "Make fists and hold" },
    { id: "charging", label: "Charging: hum, dark sky, arcs" },
    { id: "struck", label: "Strike: lightning, thunder" },
    { id: "powered", label: "Powered: eyes and voice (fades when fists drop)" },
  ],

  create(kit) {
    const S = kit.settings;
    const holds = new kit.Holds();
    const sparks = new Particles(600);
    let state = "idle", since = 0, charge = 0, calm = 0, eyesLit = false;
    let dark = 0, power = 0, flash = 0, shake = 0;
    const glow = [0, 0];
    let bolts = [], arcs = [], arcsAt = 0, bridge = null;
    let hum = null, drone = null;

    const go = (s, t, event, data) => { state = s; since = t; holds.clear(); if (event) kit.emit(event, data); };
    const need = () => Math.min(S.handsNeeded, 2);
    const isUp = (h, H) => h.palm.y < S.upLine * H;

    function strike(t, hands, H) {
      const targets = hands.filter(h => h.fist && isUp(h, H));
      const n = targets.length || 1;
      go("struck", t, "lightning_strike", `${n} bolt${n === 1 ? "" : "s"}`);
      charge = 0;
      if (hum) { hum.stop(); hum = null; }
      kit.sfx.play("thunder");
      flash = 1; shake = 1;
      const pts = targets.length ? targets.map(h => h.palm) : [{ x: kit.view.W / 2, y: kit.view.H * 0.45 }];
      pts.forEach((p, i) => bolts.push({ born: t, idx: i, useHand: !!targets.length, x0: p.x + rand(-0.22, 0.22) * kit.view.W, tx: p.x, ty: p.y, segs: null, regenAt: 0 }));
      for (const p of pts) for (let i = 0; i < 40; i++) sparks.emit(p.x, p.y, { speed: [190, 830], gravity: 700, life: [0.25, 0.8] });
    }

    function powerDown(t, why) {
      eyesLit = false; calm = 0;
      if (drone) { drone.stop(); drone = null; }
      kit.sfx.play("powerDown");
      go("idle", t, "power_down", why);
    }

    return {
      get step() { return state; },
      get progress() { return state === "charging" ? charge : state === "powered" ? calm : 0; },
      get coach() {
        const two = need() === 2;
        return {
          idle: two ? "Raise both hands above the line" : "Raise a hand above the line",
          armed: two ? "Close both hands into fists" : "Close your hand into a fist",
          charging: "Hold it…",
          struck: "",
          powered: "Keep fists up to stay powered. Drop them or show open palms to power down",
        }[state];
      },
      get voice() { return power; },

      update(f) {
        const { t, dt, hands, H } = f;
        const upN = hands.filter(h => isUp(h, H)).length;
        const fistUpN = hands.filter(h => isUp(h, H) && h.fist).length;
        const openUpN = hands.filter(h => isUp(h, H) && h.open).length;

        switch (state) {
          case "idle":
            if (holds.held("up", upN >= need(), 250, t)) go("armed", t, "hands_up", `${upN} up`);
            break;
          case "armed":
            if (holds.held("down", upN < need(), 700, t)) go("idle", t, "hands_down");
            else if (fistUpN >= need()) { go("charging", t, "charge_start"); charge = 0; hum = kit.sfx.loop("hum"); }
            break;
          case "charging":
            if (fistUpN >= need()) charge = clamp(charge + dt / (S.holdMs / 1000));
            if (hum) hum.set(charge);
            if (holds.held("lost", fistUpN < need(), 220, t)) {
              go("armed", t, "charge_cancelled"); charge = 0;
              if (hum) { hum.stop(); hum = null; }
            } else if (charge >= 1) strike(t, hands, H);
            break;
          case "struck":
            if (t - since > 550) {
              if (!eyesLit) {
                eyesLit = true;
                go("powered", t, "eyes_ignite");
                kit.emit("voice_on");
                drone = kit.sfx.loop("drone"); drone.set(1);
              } else go("powered", t);
            }
            break;
          case "powered":
            calm = holds.frac("calm", 1000, t);
            if (t - since > 1200 && holds.held("calm", openUpN >= need(), 1000, t)) powerDown(t, "palms");
            // The effect is only active while your fists are up. Once they've been down
            // (or out of frame) for the linger time, power down and let the eyes fade.
            else if (t - since > 1200 && holds.held("drop", fistUpN < need() && openUpN < need(), S.lingerMs, t)) powerDown(t, "fists dropped");
            else if (holds.held("restrike", fistUpN >= need(), S.holdMs * 0.8 + 400, t)) strike(t, hands, H);
            break;
        }

        // levels
        const darkT = state === "charging" ? 0.12 + 0.4 * charge : (state === "powered" || state === "struck") ? 0.2 : 0;
        dark = approach(dark, darkT, 1.5, 0.8, dt);
        power = approach(power, state === "powered" ? 1 : 0, 0.8, 1000 / S.fadeMs, dt);
        flash = Math.max(0, flash - dt * 3.2);
        shake = Math.max(0, shake - dt * 2.4);
        for (let i = 0; i < 2; i++) {
          const h = hands[i];
          let target = 0;
          if (h) {
            if (state === "charging") target = h.fist ? 0.15 + charge * 0.7 : 0;
            else if (state === "struck") target = 1;
            else if (state === "powered") target = h.fist ? 1 : 0.4;
          }
          glow[i] = approach(glow[i], target, 5, 2.5, dt);
          if (h && glow[i] > 0.3 && Math.random() < glow[i] * dt * 45) {
            sparks.emit(h.palm.x + rand(-1, 1) * h.size * 0.4, h.palm.y + rand(-1, 1) * h.size * 0.4, { speed: [70, 310], gravity: 700, life: [0.25, 0.8] });
          }
        }
        if (glow.some(g => g > 0.35) && Math.random() < (glow[0] + glow[1]) * dt * 2.5) kit.sfx.play("zap", 0.12 * Math.max(...glow), rand(0.03, 0.08));

        // crackling arcs around glowing fists, and a bridge between two powered fists
        if (t - arcsAt > 55) {
          arcsAt = t; arcs = [];
          hands.slice(0, 2).forEach((h, i) => {
            const g = glow[i];
            if (g < 0.12) return;
            const n = Math.round(1 + g * 3);
            for (let k = 0; k < n; k++) {
              const a1 = rand(0, Math.PI * 2), a2 = a1 + rand(0.6, 2.2);
              const r1 = h.size * rand(0.3, 0.7), r2 = h.size * rand(0.8, 1.4) * (0.6 + g * 0.6);
              arcs.push({ segs: [{ pts: boltPath(h.palm.x + Math.cos(a1) * r1, h.palm.y + Math.sin(a1) * r1, h.palm.x + Math.cos(a2) * r2, h.palm.y + Math.sin(a2) * r2, h.size * 0.35, 4), w: 1.4 + g * 1.4 }], a: g });
            }
          });
          const a = hands[0], b = hands[1];
          bridge = (state === "powered" && a && b && a.fist && b.fist && glow[0] > 0.6 && glow[1] > 0.6) ? makeBolt(a.palm.x, a.palm.y, b.palm.x, b.palm.y, 2.4, 2) : null;
        }

        sparks.update(dt);
        bolts = bolts.filter(b => t - b.born < 750);
        for (const b of bolts) {
          if (b.useHand && hands[b.idx]) { b.tx = hands[b.idx].palm.x; b.ty = hands[b.idx].palm.y; }
          if (t > b.regenAt) { b.segs = makeBolt(b.x0, -30, b.tx, b.ty, 3.2, 5); b.regenAt = t + rand(40, 80); }
        }
      },

      grade() {
        const c = COLORS[S.color] || COLORS.storm;
        return {
          darken: dark * 0.65, desaturate: power * 0.4, contrast: power * 0.15 + dark * 0.1,
          tint: c.tint, tintAmount: Math.max(power * 0.35, dark * 0.3),
          vignette: Math.max(dark * 0.8, power * 0.5), shake: 18 * shake * shake,
        };
      },

      draw(ctx, f) {
        const c = COLORS[S.color] || COLORS.storm;
        const { t, hands, face, W, H } = f;
        ctx.globalCompositeOperation = "lighter";
        hands.slice(0, 2).forEach((h, i) => {
          const g = glow[i];
          if (g < 0.02) return;
          const flick = 0.85 + Math.random() * 0.15;
          glowDot(ctx, h.palm.x, h.palm.y, h.size * (1.6 + g * 1.6), c.glow, 0.55 * g * flick);
          glowDot(ctx, h.palm.x, h.palm.y, h.size * 0.7, c.core, 0.6 * g * flick);
          for (const k of [5, 9, 13, 17]) glowDot(ctx, h.P[k].x, h.P[k].y, h.size * 0.28, c.core, 0.35 * g);
        });
        for (const a of arcs) strokeBolt(ctx, a.segs, 0.5 + a.a * 0.5, c);
        if (bridge) strokeBolt(ctx, bridge, 0.6 + Math.random() * 0.4, c);
        for (const b of bolts) {
          const age = t - b.born;
          const on = age < 90 || (age > 130 && age < 260) || (age > 330 && age < 420) || (age > 520 && age < 600);
          if (on && b.segs) { strokeBolt(ctx, b.segs, 1 - age / 900, c); glowDot(ctx, b.tx, b.ty, 160, c.glow, 0.5); }
        }
        ctx.lineCap = "round";
        sparks.draw(ctx, "spark", c);
        drawEyes(ctx, face, power, c);
        if (flash > 0) {
          const fl = flash * (Math.random() < 0.25 ? 0.4 : 1);
          ctx.fillStyle = `rgba(${c.core[0]},${c.core[1]},${c.core[2]},${Math.min(0.85, fl * 0.9)})`;
          ctx.fillRect(0, 0, W, H);
        }
      },

      overlay(ctx, f) {
        if (state !== "idle" && state !== "armed" && state !== "charging") return;
        const c = COLORS[S.color] || COLORS.storm;
        ctx.save();
        ctx.setLineDash([10, 10]); ctx.lineWidth = 2;
        ctx.strokeStyle = state === "idle" ? "rgba(214,221,232,.45)" : `rgba(${c.glow.join(",")},.8)`;
        const y = S.upLine * f.H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(f.W, y); ctx.stroke();
        ctx.restore();
      },

      trigger(f) { strike(f.t, f.hands, f.H); },
      reset(f) { if (state === "powered" || state === "struck") powerDown(f.t, "key"); },
      dispose() { if (hum) hum.stop(); if (drone) drone.stop(); },
    };
  },
};
