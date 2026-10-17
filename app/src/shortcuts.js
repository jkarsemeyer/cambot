// Gesture shortcuts that work in every mode.
//
// Mode switching:  point at an open hand → Storm Caller (lightning), at a fist → Fire Palm, at a pinch → Star Map.
// Layers on top of whatever mode is running (they change the finished picture, so calls see them):
//   Finger frame   both hands make an L (thumb and index out), framing a rectangle → zoom in on your face. Again to zoom out.
//   Mirror         both open hands held upright, side by side → mirror at the middle line. Again for the other side, again for off.
//   Thumbs up      → confetti
//   Peace sign     → glitch burst
//
// Each gesture has to be held briefly, and after one fires the hands have to let go of it before it can fire
// again, so ordinary talking-with-your-hands doesn't set these off.

import { clamp, rand, dist, Holds } from "./util.js";
import { glowDot } from "./draw.js";

export const MODE_FOR = { open: "storm-caller", fist: "fire-palm", pinch: "star-map" };
const MODE_LABEL = { "storm-caller": "Storm Caller", "fire-palm": "Fire Palm", "star-map": "Star Map" };

export const SHORTCUTS = [
  { id: "select", name: "Switch mode", how: "Point at an open hand for Storm Caller, a fist for Fire Palm, or a pinch for Star Map" },
  { id: "zoom", name: "Finger frame zoom", how: "Make an L with both hands to frame a rectangle. Again to zoom out" },
  { id: "mirror", name: "Mirror", how: "Both open hands upright, side by side. Again for the other side, again for off" },
  { id: "confetti", name: "Confetti", how: "Thumbs up" },
  { id: "glitch", name: "Glitch", how: "Peace sign" },
  { id: "present", name: "Present slides", how: "Part both open hands like curtains to start, bring them back together to stop. Swipe one hand to change slides" },
];

const HOLD = { select: 700, zoom: 500, mirror: 600, confetti: 350, glitch: 400 };
const CONFETTI_COLORS = ["#ff4d6d", "#ffd23f", "#3ee08f", "#4cc9f0", "#b388ff", "#ffffff"];
const MODE_COLORS = { "storm-caller": [120, 200, 255], "fire-palm": [255, 140, 40], "star-map": [200, 190, 255] };
const ease = x => x * x * (3 - 2 * x);

export function createShortcuts({ play, emit, switchTo, currentMode, modeIsIdle, present = null, mirrored = () => true }) {
  const holds = new Holds();
  const latched = new Set();              // gestures that fired and are waiting to be released
  let cooldownUntil = 0;

  let candidate = null;                   // { id, frac, at, label, color } while a gesture is being held
  const hist = [];                        // recent hand positions, for gestures that are movements
  let curtainCool = 0, swipeCool = 0, noteUntil = 0, lastMirror = null, lastSwipe = null;
  const zoom = { on: false, amt: 0, cx: null, cy: null, s: 1 };
  const mirror = { mode: 0, amt: 0, lineX: null, shown: 1 };
  let confetti = [];
  let glitchUntil = 0, glitchStart = 0;
  let burst = null;                       // short glow where a mode switch happened

  let tmp = null, tctx = null;
  const scratch = (W, H) => {
    if (!tmp || tmp.width !== W || tmp.height !== H) {
      tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
      tctx = tmp.getContext("2d");
    }
    tctx.globalCompositeOperation = "source-over";
    tctx.clearRect(0, 0, W, H);
    return tctx;
  };

  // true once `cond` has held for the hold time; then latched until cond goes false again
  function fire(id, cond, t) {
    if (!cond) { latched.delete(id); holds.clear(id); return false; }
    if (latched.has(id) || t < cooldownUntil) return false;
    if (holds.held(id, true, HOLD[id], t)) { latched.add(id); holds.clear(id); cooldownUntil = t + 500; return true; }
    return false;
  }

  function spawnConfetti(x, y, W) {
    for (let i = 0; i < 170; i++) {
      const a = -Math.PI / 2 + rand(-0.9, 0.9);
      const v = rand(500, 1300) * (W / 1280);
      confetti.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: rand(0, 6.28), vr: rand(-12, 12),
        w: rand(8, 16) * (W / 1280), h: rand(5, 9) * (W / 1280), c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        life: rand(2.2, 3.4), age: 0, flutter: rand(0, 6.28),
      });
    }
  }

  return {
    // What's on right now, for the HUD chip.
    get active() {
      const a = [];
      if (zoom.on) a.push("Zoom");
      if (mirror.mode) a.push(mirror.mode === 1 ? "Mirror L" : "Mirror R");
      return a;
    },
    get candidate() { return candidate; },

    // Returns true while a shortcut gesture is being held, so the mode ignores those hands.
    update(f) {
      const { t, dt, hands, face, W, H } = f;
      candidate = null;
      let busy = false;
      const two = hands.length >= 2 ? hands.slice(0, 2) : null;

      // 1. Mode switch: one hand points at the other hand's palm.
      let sel = null;
      if (two) {
        for (const [a, b] of [[two[0], two[1]], [two[1], two[0]]]) {
          if (!a.point || b.point) continue;
          const shape = b.fist ? "fist" : b.pinch ? "pinch" : b.open ? "open" : null;
          if (shape && dist(a.tip, b.palm) < b.size * 1.15) { sel = { target: MODE_FOR[shape], at: b.palm }; break; }
        }
      }
      const selKey = sel ? `select:${sel.target}` : null;
      for (const k of Object.values(MODE_FOR).map(m => `select:${m}`)) if (k !== selKey) { holds.clear(k); latched.delete(k); }
      if (sel) {
        const same = sel.target === currentMode();
        const label = MODE_LABEL[sel.target];
        if (!same) busy = true;   // pointing at a hand for the mode you're already in is left to the mode
        if (!same && modeIsIdle()) {
          HOLD[selKey] = HOLD.select;
          candidate = { id: "select", frac: holds.frac(selKey, HOLD.select, t), at: sel.at, label, color: MODE_COLORS[sel.target] };
          if (fire(selKey, true, t)) {
            switchTo(sel.target);
            play("whoosh", 0.7, 0.8); play("blip", 660, 0.12);
            burst = { x: sel.at.x, y: sel.at.y, born: t, color: MODE_COLORS[sel.target] };
            emit("shortcut_mode", label);
          }
        } else {
          if (!same) candidate = { id: "select", frac: 0, at: sel.at, label: "Finish this effect first", color: [200, 205, 215] };
        }
      }

      // 2. Finger frame: both hands make an L.
      const frame = !!two && two[0].L && two[1].L && Math.abs(two[0].palm.x - two[1].palm.x) > (two[0].size + two[1].size);
      if (frame) { busy = true; candidate = { id: "zoom", frac: holds.frac("zoom", HOLD.zoom, t), at: { x: (two[0].palm.x + two[1].palm.x) / 2, y: (two[0].palm.y + two[1].palm.y) / 2 }, label: zoom.on ? "Zoom out" : "Zoom in" }; }
      if (fire("zoom", frame, t)) { zoom.on = !zoom.on; play("whoosh", 0.4, 0.5); emit("shortcut_zoom", zoom.on ? "in" : "out"); }

      // 2b. Presenting: part the curtains to start, close them to stop, swipe one hand to change slides.
      if (present) {
        const openish = h => h.open || h.extended >= 3;
        const both = !!two && openish(two[0]) && openish(two[1]);
        const sz = two ? two[0].size + two[1].size : 0;
        const d = two ? Math.abs(two[0].palm.x - two[1].palm.x) : 0;
        hist.push({ t, n: hands.length, both, d, sz, p: hands.length === 1 ? { x: hands[0].palm.x, y: hands[0].palm.y, open: openish(hands[0]) } : null });
        while (hist.length && t - hist[0].t > 900) hist.shift();
        const recent = ms => hist.filter(e => t - e.t <= ms && e !== hist[hist.length - 1]);
        const apart = (dd, ss) => dd > Math.max(W * 0.32, ss * 2.4);
        const together = (dd, ss) => dd < ss * 1.5;
        if (t > curtainCool && both) {
          const was = recent(800).filter(e => e.both);
          if (!present.on && apart(d, sz) && was.some(e => together(e.d, e.sz))) {
            curtainCool = t + 1500;
            if (lastMirror && t - lastMirror.t < 1500) mirror.mode = lastMirror.prev;   // pausing hands together may have toggled mirror; undo it
            if (present.loaded) { present.set(true); play("whoosh", 0.5, 0.9); emit("shortcut_present", "on"); }
            else noteUntil = t + 1500;
          } else if (present.on && together(d, sz) && was.some(e => apart(e.d, e.sz))) {
            curtainCool = t + 1500;
            present.set(false); play("whoosh", 0.4, 0.7); emit("shortcut_present", "off");
          }
        }
        // swipe: one hand in view, moving fast sideways
        const now = hist[hist.length - 1];
        if (present.on && now.p && now.p.open && t > swipeCool) {
          const past = recent(380).find(e => e.n === 1 && e.p);
          if (past && hist.filter(e => t - e.t <= 380).every(e => e.n === 1)) {
            const dx = now.p.x - past.p.x, dy = now.p.y - past.p.y;
            if (Math.abs(dx) > W * 0.2 && Math.abs(dy) < Math.abs(dx) * 0.6) {
              const towardsYourLeft = (mirrored() ? dx : -dx) < 0;   // like turning a page: right-to-left is next
              const dir = towardsYourLeft ? 1 : -1;
              // bringing your hand back after a swipe is a fast move the other way: ignore it for a moment
              if (lastSwipe && dir !== lastSwipe.dir && t - lastSwipe.t < 1200) { swipeCool = Math.max(swipeCool, t + 300); }
              else {
                swipeCool = t + 800; lastSwipe = { t, dir };
                if (dir > 0 ? present.next() : present.prev()) play("whoosh", 0.25, 0.35);
              }
            }
          }
        }
        if (t < noteUntil && two) candidate = { id: "present", frac: 0, at: { x: (two[0].palm.x + two[1].palm.x) / 2, y: Math.min(two[0].palm.y, two[1].palm.y) }, label: "Load slides first", color: [200, 205, 215] };
      }

      // 3. Mirror: both open hands upright, close together side by side. (Off while presenting: it would flip your slides.)
      const pair = !!two && !(present && present.on) && t > curtainCool && two[0].upright && two[1].upright
        && Math.abs(two[0].palm.x - two[1].palm.x) < (two[0].size + two[1].size) * 1.4
        && Math.abs(two[0].palm.y - two[1].palm.y) < (two[0].size + two[1].size) * 0.6;
      if (pair) { busy = true; candidate = { id: "mirror", frac: holds.frac("mirror", HOLD.mirror, t), at: { x: (two[0].palm.x + two[1].palm.x) / 2, y: Math.min(two[0].palm.y, two[1].palm.y) }, label: ["Mirror left", "Mirror right", "Mirror off"][mirror.mode] }; }
      if (fire("mirror", pair, t)) {
        lastMirror = { t, prev: mirror.mode };
        mirror.mode = (mirror.mode + 1) % 3;
        if (mirror.mode) mirror.shown = mirror.mode;
        play("blip", mirror.mode ? 990 : 440, 0.14);
        emit("shortcut_mirror", ["off", "left", "right"][mirror.mode]);
      }

      // 4. Thumbs up → confetti. 5. Peace sign → glitch.
      const thumbHand = hands.find(h => h.thumbsUp);
      if (fire("confetti", !!thumbHand, t)) { spawnConfetti(thumbHand.P[4].x, thumbHand.P[4].y, W); play("whoosh", 0.5, 0.4); play("blip", 1320, 0.1); emit("shortcut_confetti"); }
      const peace = hands.some(h => h.peace);
      if (fire("glitch", peace, t)) { glitchStart = t; glitchUntil = t + 1400; play("zap", 0.35, 0.12); play("zap", 0.3, 0.08, 0.15); emit("shortcut_glitch"); }

      // animate
      zoom.amt = clamp(zoom.amt + (zoom.on ? dt : -dt) * 2.2);
      mirror.amt = clamp(mirror.amt + (mirror.mode ? dt : -dt) * 3);
      const k = 1 - Math.exp(-dt * 7);
      const fx = face ? (face.eyes[0].c.x + face.eyes[1].c.x) / 2 : W / 2;
      const fy = face ? (face.eyes[0].c.y + face.eyes[1].c.y) / 2 + face.faceH * 0.12 : H / 2;
      zoom.cx = zoom.cx == null ? fx : zoom.cx + (fx - zoom.cx) * k;
      zoom.cy = zoom.cy == null ? fy : zoom.cy + (fy - zoom.cy) * k;
      const targetS = face ? clamp((H * 0.55) / face.faceH, 1.4, 3) : 1.8;
      zoom.s += (targetS - zoom.s) * k;
      const lx = face ? face.P[168].x : W / 2;   // point between the eyes
      mirror.lineX = mirror.lineX == null ? lx : mirror.lineX + (lx - mirror.lineX) * k;
      for (const p of confetti) {
        p.age += dt; p.vy += 900 * dt * (W / 1280); p.vx *= Math.pow(0.35, dt); p.vy *= Math.pow(0.6, dt);
        p.x += p.vx * dt + Math.sin(p.age * 6 + p.flutter) * 40 * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      }
      confetti = confetti.filter(p => p.age < p.life && p.y < H + 40);
      if (burst && t - burst.born > 600) burst = null;
      return busy;
    },

    // Where a picture point ends up after the zoom layer, so text can follow the zoomed picture.
    mapPoint(p, W, H) {
      if (zoom.amt <= 0.001) return { x: p.x, y: p.y };
      const s = 1 + (zoom.s - 1) * ease(zoom.amt);
      const sw = W / s, sh = H / s;
      const sx = clamp(zoom.cx - sw / 2, 0, W - sw), sy = clamp(zoom.cy - sh / 2, 0, H - sh);
      return { x: (p.x - sx) * s, y: (p.y - sy) * s };
    },

    // Applied to the finished picture, after the mode has drawn. Everything here is what calls see.
    post(ctx, f) {
      const { t, W, H } = f;
      const canvas = ctx.canvas;

      if (zoom.amt > 0.001) {
        const s = 1 + (zoom.s - 1) * ease(zoom.amt);
        const sw = W / s, sh = H / s;
        const sx = clamp(zoom.cx - sw / 2, 0, W - sw), sy = clamp(zoom.cy - sh / 2, 0, H - sh);
        scratch(W, H).drawImage(canvas, 0, 0);
        ctx.drawImage(tmp, sx, sy, sw, sh, 0, 0, W, H);
      }

      if (mirror.amt > 0.001) {
        // The line sits between your eyes; the kept half is reflected across it.
        const lx = clamp(mirror.lineX, W * 0.2, W * 0.8);
        scratch(W, H).drawImage(canvas, 0, 0);
        ctx.save();
        ctx.globalAlpha = ease(mirror.amt);
        ctx.beginPath();
        if (mirror.shown === 1) ctx.rect(lx, 0, W - lx, H); else ctx.rect(0, 0, lx, H);
        ctx.clip();
        ctx.translate(2 * lx, 0); ctx.scale(-1, 1);
        ctx.drawImage(tmp, 0, 0);
        ctx.restore();
      }

      if (t < glitchUntil) {
        const k = 1 - (t - glitchStart) / (glitchUntil - glitchStart);
        if (Math.random() < 0.85) {
          scratch(W, H).drawImage(canvas, 0, 0);
          const n = 4 + Math.floor(Math.random() * 8 * k);
          for (let i = 0; i < n; i++) {
            const y = rand(0, H), h = rand(4, 60) * (H / 720), dx = rand(-1, 1) * 90 * k * (W / 1280);
            ctx.drawImage(tmp, 0, y, W, h, dx, y, W, h);
          }
          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.globalAlpha = 0.35 * k;
          ctx.drawImage(tmp, rand(6, 16) * k, 0);
          ctx.globalCompositeOperation = "difference";
          ctx.globalAlpha = Math.random() < 0.12 * k ? 0.8 : 0;
          if (ctx.globalAlpha) { ctx.fillStyle = "#0ff"; ctx.fillRect(0, rand(0, H), W, rand(10, 80)); }
          ctx.restore();
        }
      }

      if (burst) {
        const a = 1 - (t - burst.born) / 600;
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        glowDot(ctx, burst.x, burst.y, 120 + (1 - a) * 500, burst.color, 0.7 * a);
        ctx.restore();
      }

      if (confetti.length) {
        ctx.save();
        for (const p of confetti) {
          ctx.globalAlpha = clamp((p.life - p.age) / 0.6);
          ctx.fillStyle = p.c;
          ctx.setTransform(1, 0, 0, 1, p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.age * 9 + p.flutter)), p.w, p.h * Math.abs(Math.cos(p.age * 9 + p.flutter)) + 1);
        }
        ctx.restore();
      }
    },

    // Screen-only guide: a ring filling up around the hands while a shortcut is being held.
    overlay(vctx) {
      if (!candidate) return;
      const { at, frac, label, color = [143, 211, 255] } = candidate;
      vctx.save();
      vctx.lineWidth = 4;
      vctx.strokeStyle = "rgba(255,255,255,.25)";
      vctx.beginPath(); vctx.arc(at.x, at.y, 46, 0, Math.PI * 2); vctx.stroke();
      vctx.strokeStyle = `rgb(${color.join(",")})`;
      vctx.beginPath(); vctx.arc(at.x, at.y, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); vctx.stroke();
      vctx.font = "600 15px 'IBM Plex Mono', monospace";
      vctx.textAlign = "center"; vctx.fillStyle = "#fff";
      vctx.fillText(label.toUpperCase(), at.x, at.y - 60);
      vctx.restore();
    },

    trigger(id, f) {
      if (id === "zoom") zoom.on = !zoom.on;
      else if (id === "mirror") { mirror.mode = (mirror.mode + 1) % 3; if (mirror.mode) mirror.shown = mirror.mode; }
      else if (id === "confetti") spawnConfetti(f.W / 2, f.H * 0.9, f.W);
      else if (id === "glitch") { glitchStart = f.t; glitchUntil = f.t + 1400; }
    },

    reset() { zoom.on = false; mirror.mode = 0; confetti = []; glitchUntil = 0; latched.clear(); holds.clear(); },
  };
}
