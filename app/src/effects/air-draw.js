// Air Draw: pinch your thumb and index finger together to draw in the air. Release to lift the pen.
//
//   Pinch and move         draw. The pen is the point between your thumb and fingertip.
//   Hold still at the end  of a stroke to straighten a line or round off a circle.
//   Pinch a swatch         in the palette at the top of your screen to change colour (only you see it).
//   Pinch the bin          to clear, or hold two fists.
//   Hold a fist            and move it over ink to erase (open palms were too easy to set off while talking).
//
// By default the ink goes to calls without the mirror flip, so writing reads correctly for everyone.

import { clamp, dist, rand } from "../util.js";
import { glowDot, Particles } from "../draw.js";

const PALETTE = [
  { id: "cyan",   rgb: [80, 220, 255] },
  { id: "pink",   rgb: [255, 80, 200] },
  { id: "yellow", rgb: [255, 228, 80] },
  { id: "green",  rgb: [90, 255, 150] },
  { id: "orange", rgb: [255, 150, 50] },
  { id: "white",  rgb: [255, 255, 255] },
];
const BIN = { id: "bin" };
const SWATCHES = [...PALETTE, BIN];

// One Euro filter: smooths jitter when the hand is slow, stays responsive when it's fast.
class OneEuro {
  constructor(minCut = 1.6, beta = 0.02, dCut = 1) { this.minCut = minCut; this.beta = beta; this.dCut = dCut; this.x = null; this.dx = 0; }
  alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  filter(v, dt) {
    if (this.x == null) { this.x = v; return v; }
    const d = (v - this.x) / dt;
    this.dx += this.alpha(this.dCut, dt) * (d - this.dx);
    const cut = this.minCut + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cut, dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

const mixWhite = (c, k) => c.map(v => Math.round(v + (255 - v) * k));

export default {
  id: "air-draw",
  name: "Air Draw",
  blurb: "Pinch to draw in the air. Hold still to snap a shape. A held fist erases, two fists clear.",
  voice: { pitch: 1, electric: 0, mix: 0 },
  settings: [
    { key: "style", label: "Ink", type: "select", options: [["neon", "Neon"], ["marker", "Marker"]], default: "neon" },
    { key: "width", label: "Thickness", type: "range", min: 2, max: 16, step: 1, default: 6, format: v => `${v} px` },
    { key: "fade", label: "Ink fades after", type: "select", options: [[0, "Never"], [5, "5 seconds"], [15, "15 seconds"], [60, "1 minute"]], default: 0 },
    { key: "callView", label: "On calls", type: "select", options: [["readable", "Writing reads correctly"], ["follow", "Lined up with you (writing is backwards)"]], default: "readable" },
    { key: "snap", label: "Hold still to snap lines and circles", type: "toggle", default: true },
    { key: "wipe", label: "Erase with a held fist", type: "toggle", default: true },
  ],
  idleSteps: ["idle", "inked"],
  steps: [
    { id: "idle", label: "Pinch thumb and finger to draw" },
    { id: "drawing", label: "Drawing (release to lift the pen)" },
    { id: "inked", label: "Hold still to snap · held fist erases · two fists clear" },
  ],

  create(kit) {
    const S = kit.settings;
    const holds = new kit.Holds();
    const sparks = new Particles(300);
    const fx = new OneEuro(), fy = new OneEuro();

    let strokes = [];                 // { rgb, w, style, pts: [{x,y}], born }
    let cur = null;                   // stroke being drawn
    let penHand = -1, pinched = false, pen = null, penSeen = 0;
    let colour = PALETTE[0], hoverSwatch = null, pickedAt = 0;
    let still = { x: 0, y: 0, since: 0 }, snapped = false, snapFlash = null;
    let wiping = null, clearing = null;
    let cache = null, cctx = null, cacheDirty = true;

    const sc = W => W / 1280;
    const swatchAt = (W, H) => SWATCHES.map((s, i) => ({ s, x: W / 2 + (i - (SWATCHES.length - 1) / 2) * 62 * sc(W), y: 46 * sc(W), r: 17 * sc(W) }));
    const fading = () => Number(S.fade) > 0;

    // Pinch with hysteresis, so a stroke doesn't break up as your fingers wobble.
    const pinchState = (h, was) => {
      const d = dist(h.P[4], h.P[8]) / h.size;
      return was ? d < 0.5 : d < 0.3;
    };

    function strokeLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; }

    // Straighten a nearly-straight stroke, or round off a nearly-round closed one.
    function trySnap(st) {
      const p = st.pts, L = strokeLen(p);
      if (p.length < 6 || L < 50) return false;
      const a = p[0], b = p[p.length - 1], chord = dist(a, b);
      let maxDev = 0;
      for (const q of p) {
        const dev = chord < 1 ? dist(q, a) : Math.abs((b.x - a.x) * (a.y - q.y) - (a.x - q.x) * (b.y - a.y)) / chord;
        maxDev = Math.max(maxDev, dev);
      }
      if (chord > 40 && maxDev / chord < 0.09) { st.pts = [a, b]; return "line"; }
      if (chord < L * 0.2) {
        const cx = p.reduce((s, q) => s + q.x, 0) / p.length, cy = p.reduce((s, q) => s + q.y, 0) / p.length;
        const rs = p.map(q => Math.hypot(q.x - cx, q.y - cy)), rm = rs.reduce((s, r) => s + r, 0) / rs.length;
        const sd = Math.sqrt(rs.reduce((s, r) => s + (r - rm) ** 2, 0) / rs.length);
        if (rm > 20 && sd / rm < 0.2) {
          const xs = p.map(q => q.x), ys = p.map(q => q.y);
          const rx = (Math.max(...xs) - Math.min(...xs)) / 2, ry = (Math.max(...ys) - Math.min(...ys)) / 2;
          const ccx = (Math.max(...xs) + Math.min(...xs)) / 2, ccy = (Math.max(...ys) + Math.min(...ys)) / 2;
          const round = Math.abs(rx - ry) / Math.max(rx, ry) < 0.2;   // nearly a circle → make it a true circle
          const R = (rx + ry) / 2;
          st.pts = Array.from({ length: 73 }, (_, i) => { const t = i / 72 * Math.PI * 2; return { x: ccx + Math.cos(t) * (round ? R : rx), y: ccy + Math.sin(t) * (round ? R : ry) }; });
          return "circle";
        }
      }
      return false;
    }

    function startStroke(p, t) {
      cur = { rgb: colour.rgb, w: S.width, style: S.style, pts: [p], born: t };
      still = { x: p.x, y: p.y, since: t }; snapped = false;
    }
    function endStroke() {
      if (cur && (cur.pts.length > 1 || strokeLen(cur.pts) === 0)) { strokes.push(cur); cacheDirty = true; }
      cur = null; fx.reset(); fy.reset();
    }
    function clearAll(t) {
      if (!strokes.length && !cur) return;
      clearing = { born: t, strokes: strokes.concat(cur ? [cur] : []) };
      strokes = []; cur = null; cacheDirty = true;
      kit.sfx.play("whoosh", 0.3, 0.6);
      kit.emit("ink_cleared");
    }

    // Erase every point under the fist, splitting strokes where the gaps fall.
    function wipe(at, R) {
      let changed = false;
      const out = [];
      for (const st of strokes) {
        if (st.pts.length === 2) {           // snapped line: erase it whole if the fist crosses it
          const [a, b] = st.pts, L = dist(a, b) || 1;
          const tt = clamp(((at.x - a.x) * (b.x - a.x) + (at.y - a.y) * (b.y - a.y)) / (L * L));
          if (dist(at, { x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt }) < R) { changed = true; continue; }
          out.push(st); continue;
        }
        let run = [];
        let hit = false;
        for (const q of st.pts) {
          if (dist(q, at) < R) { hit = true; if (run.length > 1) out.push({ ...st, pts: run }); run = []; }
          else run.push(q);
        }
        if (!hit) { out.push(st); continue; }
        changed = true;
        if (run.length > 1) out.push({ ...st, pts: run });
      }
      if (changed) { strokes = out; cacheDirty = true; }
      return changed;
    }

    function path(ctx, pts) {
      ctx.beginPath();
      if (pts.length === 1) { ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[0].x + 0.1, pts[0].y); return; }
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
      }
      const z = pts[pts.length - 1]; ctx.lineTo(z.x, z.y);
    }
    function drawStroke(ctx, st, s, alpha = 1) {
      if (alpha <= 0.01) return;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const w = st.w * s;
      if (st.style === "marker") {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = `rgba(${st.rgb.join(",")},${0.95 * alpha})`; ctx.lineWidth = w * 1.3;
        path(ctx, st.pts); ctx.stroke();
        return;
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(${st.rgb.join(",")},${0.14 * alpha})`; ctx.lineWidth = w * 4;
      path(ctx, st.pts); ctx.stroke();
      ctx.strokeStyle = `rgba(${st.rgb.join(",")},${0.4 * alpha})`; ctx.lineWidth = w * 1.9;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${mixWhite(st.rgb, 0.65).join(",")},${0.95 * alpha})`; ctx.lineWidth = w * 0.75;
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    const strokeAlpha = (st, t) => {
      const sec = Number(S.fade);
      if (!sec) return 1;
      return clamp(1 - (t - st.born - sec * 1000) / 1200);
    };

    function renderInk(ctx, f) {
      const { t, W, H } = f, s = sc(W);
      if (fading()) {
        strokes = strokes.filter(st => strokeAlpha(st, t) > 0);
        for (const st of strokes) drawStroke(ctx, st, s, strokeAlpha(st, t));
      } else {
        // finished ink is drawn once into a cache, so long drawings stay cheap
        if (!cache || cache.width !== W || cache.height !== H) { cache = document.createElement("canvas"); cache.width = W; cache.height = H; cctx = cache.getContext("2d"); cacheDirty = true; }
        if (cacheDirty) { cctx.clearRect(0, 0, W, H); for (const st of strokes) drawStroke(cctx, st, s); cacheDirty = false; }
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(cache, 0, 0);
      }
      if (cur) drawStroke(ctx, cur, s);
      if (clearing) {
        const k = clamp((t - clearing.born) / 600);
        ctx.save(); ctx.translate(0, -k * k * 60 * s);
        for (const st of clearing.strokes) drawStroke(ctx, st, s, 1 - k);
        ctx.restore();
      }
      if (snapFlash) {
        const k = clamp((t - snapFlash.born) / 500);
        glowDot(ctx, snapFlash.x, snapFlash.y, (20 + 60 * k) * s, snapFlash.rgb, 0.5 * (1 - k));
      }
      ctx.globalCompositeOperation = "lighter";
      sparks.draw(ctx, "ember", { glow: colour.rgb || [255, 255, 255], core: [255, 255, 255] });
      ctx.globalCompositeOperation = "source-over";
    }

    return {
      get step() { return cur ? "drawing" : strokes.length ? "inked" : "idle"; },
      get progress() { return holds.frac("clear", 900, performance.now()); },
      get coach() {
        if (cur) return snapped ? "Snapped. Release to lift the pen" : "Drawing. Release your pinch to lift the pen";
        if (!strokes.length) return "Pinch your thumb and finger together and move to draw";
        return "Pinch a colour at the top · held fist erases · two fists clear";
      },
      get voice() { return 0; },
      get inkCount() { return strokes.length; },

      update(f) {
        const { t, dt, hands, W, H } = f;
        const s = sc(W);

        // the drawing hand: keep the one already drawing, else whichever starts pinching
        let h = penHand >= 0 ? hands[penHand] : null;
        if (!h || (!pinched && !pinchState(h, false))) {
          penHand = hands.findIndex(x => !x.fist && pinchState(x, false));
          h = penHand >= 0 ? hands[penHand] : null;
        }
        const nowPinched = !!h && pinchState(h, pinched);
        if (h) {
          const raw = { x: (h.P[4].x + h.P[8].x) / 2, y: (h.P[4].y + h.P[8].y) / 2 };
          const ddt = Math.max(0.008, dt);
          pen = { x: fx.filter(raw.x, ddt), y: fy.filter(raw.y, ddt) };
          penSeen = t;
        } else if (t - penSeen > 200) { pen = null; fx.reset(); fy.reset(); }

        // palette: a pinch that starts on a swatch picks it instead of drawing
        hoverSwatch = null;
        if (pen) for (const w of swatchAt(W, H)) if (dist(pen, w) < w.r * 1.7) hoverSwatch = w.s;
        if (nowPinched && !pinched) {
          if (hoverSwatch) {
            if (hoverSwatch === BIN) clearAll(t);
            else { colour = hoverSwatch; kit.sfx.play("blip", 990, 0.08); kit.emit("ink_colour", colour.id); }
            pickedAt = t;
          } else if (pen) startStroke(pen, t);
        }
        if (nowPinched && cur && pen) {
          const last = cur.pts[cur.pts.length - 1];
          if (!snapped && dist(last, pen) > 1.5 * s) cur.pts.push({ x: pen.x, y: pen.y });
          if (dist(pen, still) > 6 * s) still = { x: pen.x, y: pen.y, since: t };
          else if (S.snap && !snapped && t - still.since > 450) {
            const kind = trySnap(cur);
            snapped = true;
            if (kind) { snapFlash = { x: pen.x, y: pen.y, rgb: cur.rgb, born: t }; kit.sfx.play("chime", kind === "line" ? 880 : 1046.5, 0.07); kit.emit("ink_snap", kind); }
          }
          if (Math.random() < dt * 30) sparks.emit(pen.x, pen.y, { speed: [20, 80], gravity: 40, drag: 0.92, life: [0.15, 0.4], size: [1, 1.8] });
        }
        if (!nowPinched && pinched) endStroke();
        pinched = nowPinched;

        // a fist, held for a moment, erases whatever it moves over
        wiping = null;
        if (S.wipe && strokes.length) {
          const fist = hands.find((x, i) => x.fist && i !== penHand);
          if (fist && holds.held("fist", true, 350, t)) {
            const R = fist.size * 0.75;
            wiping = { x: fist.palm.x, y: fist.palm.y, R };
            if (wipe(fist.palm, R) && Math.random() < 0.3) kit.sfx.play("hiss", 0.05, 0.12);
          } else if (!fist) holds.clear("fist");
        }

        // two fists clear
        const fists = hands.length >= 2 && hands[0].fist && hands[1].fist;
        if (holds.held("clear", fists && strokes.length > 0, 900, t)) { holds.clear("clear"); clearAll(t); }

        if (clearing && t - clearing.born > 600) clearing = null;
        if (snapFlash && t - snapFlash.born > 500) snapFlash = null;
        sparks.update(dt);
      },

      grade() { return {}; },

      // "Lined up with you": ink is part of the picture, so it flips with it on calls.
      draw(ctx, f) { if (S.callView === "follow") renderInk(ctx, f); },
      // "Writing reads correctly": ink goes to calls without the mirror flip.
      readable(ctx, f) { if (S.callView === "follow") return false; renderInk(ctx, f); },

      // Screen-only: palette, pen cursor and eraser ring.
      overlay(ctx, f) {
        const { t, W, H } = f, s = sc(W);
        const near = pen && pen.y < 140 * s ? 1 : 0.55;
        ctx.save();
        for (const w of swatchAt(W, H)) {
          const on = w.s === colour, hov = w.s === hoverSwatch;
          ctx.globalAlpha = near * (hov ? 1 : 0.85);
          ctx.beginPath(); ctx.arc(w.x, w.y, w.r * (hov ? 1.2 : 1), 0, Math.PI * 2);
          if (w.s === BIN) {
            ctx.fillStyle = "rgba(20,24,32,.8)"; ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1.5 * s; ctx.stroke();
            ctx.fillStyle = "#fff"; ctx.font = `600 ${Math.round(13 * s)}px 'IBM Plex Mono', monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("CLR", w.x, w.y + 0.5);
          } else {
            ctx.fillStyle = `rgb(${w.s.rgb.join(",")})`; ctx.fill();
            if (on) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.arc(w.x, w.y, w.r + 5 * s, 0, Math.PI * 2); ctx.stroke(); }
          }
        }
        ctx.globalAlpha = 1;
        if (pen && t - pickedAt > 150) {
          ctx.strokeStyle = `rgba(${colour.rgb.join(",")},.95)`; ctx.lineWidth = 2 * s;
          ctx.beginPath(); ctx.arc(pen.x, pen.y, (pinched ? 5 : 9) * s, 0, Math.PI * 2);
          if (pinched) { ctx.fillStyle = `rgb(${colour.rgb.join(",")})`; ctx.fill(); } else ctx.stroke();
        }
        if (wiping) {
          ctx.setLineDash([5 * s, 6 * s]); ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 2 * s;
          ctx.beginPath(); ctx.arc(wiping.x, wiping.y, wiping.R, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      },

      // Space: a quick demo drawing (writes "HI", underlines it, circles it).
      trigger(f) {
        const { W, H, t } = f;
        const P = (x, y) => ({ x: x * W, y: y * H });
        const add = (rgb, pts) => strokes.push({ rgb, w: S.width, style: S.style, pts, born: t });
        add(PALETTE[0].rgb, [P(0.16, 0.3), P(0.16, 0.5)]);
        add(PALETTE[0].rgb, [P(0.24, 0.3), P(0.24, 0.5)]);
        add(PALETTE[0].rgb, [P(0.16, 0.4), P(0.24, 0.4)]);
        add(PALETTE[0].rgb, [P(0.3, 0.3), P(0.3, 0.5)]);
        add(PALETTE[2].rgb, [P(0.13, 0.56), P(0.33, 0.56)]);
        add(PALETTE[1].rgb, Array.from({ length: 49 }, (_, i) => { const a = i / 48 * Math.PI * 2; return P(0.23 + Math.cos(a) * 0.13, 0.42 + Math.sin(a) * 0.22); }));
        cacheDirty = true;
      },
      reset(f) { clearAll(f.t); },
      undo() { if (strokes.length) { strokes.pop(); cacheDirty = true; } },
      dispose() {},
    };
  },
};
