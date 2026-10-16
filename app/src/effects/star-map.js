// Star Map: pinch to place stars, point to link them into constellations. Finished constellations
// get made-up names, each subtitled "An Array of Stars". With every constellation you name, the room
// behind you fades a little further into a night sky (you stay in front of it).
//
//   Pinch (thumb and index together)  place a star where you pinch. Keep pinching to drag it into place.
//                                     Pinch an existing star to move it; its lines follow.
//   Point (index finger out)          touch a star, then sweep to other stars to link them.
//                                     Lower your finger to finish. Three or more linked stars get a name.
//   Two fists, held                   clear the sky.

import { clamp, rand, dist, approach } from "../util.js";
import { glowDot, Particles } from "../draw.js";

// The night sky behind you, per starlight colour: top of sky, middle, horizon, Milky Way tint.
const SKIES = {
  silver: { top: [3, 5, 14], mid: [7, 12, 32], low: [16, 24, 58], band: [150, 170, 230] },
  gold:   { top: [5, 4, 14], mid: [14, 10, 34], low: [44, 26, 52], band: [235, 200, 170] },
  rose:   { top: [6, 3, 14], mid: [18, 8, 36], low: [46, 16, 56], band: [230, 170, 220] },
};

// Paints the still parts of the sky once (gradient, Milky Way, a few thousand faint stars).
function paintSkyBase(W, H, sky) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"), sc = W / 1280;
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgb(${sky.top})`); g.addColorStop(0.55, `rgb(${sky.mid})`); g.addColorStop(1, `rgb(${sky.low})`);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // Milky Way: a soft diagonal band of glow and dust
  const bx0 = -0.1 * W, by0 = 0.95 * H, bx1 = 1.1 * W, by1 = 0.05 * H;
  x.globalCompositeOperation = "lighter";
  for (let i = 0; i < 260; i++) {
    const k = Math.random(), off = (Math.random() + Math.random() + Math.random() - 1.5) * 0.11 * H;
    const nx = -(by1 - by0), ny = bx1 - bx0, nl = Math.hypot(nx, ny);
    const px = bx0 + (bx1 - bx0) * k + (nx / nl) * off, py = by0 + (by1 - by0) * k + (ny / nl) * off;
    const r = (30 + Math.random() * 110) * sc, a = 0.018 + Math.random() * 0.03;
    const rg = x.createRadialGradient(px, py, 0, px, py, r);
    rg.addColorStop(0, `rgba(${sky.band},${a})`); rg.addColorStop(1, `rgba(${sky.band},0)`);
    x.fillStyle = rg; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // dark dust lane down the middle of the band
  x.globalCompositeOperation = "source-over";
  for (let i = 0; i < 70; i++) {
    const k = Math.random(), off = (Math.random() - 0.5) * 0.04 * H;
    const px = bx0 + (bx1 - bx0) * k, py = by0 + (by1 - by0) * k + off, r = (20 + Math.random() * 50) * sc;
    const rg = x.createRadialGradient(px, py, 0, px, py, r);
    rg.addColorStop(0, `rgba(${sky.top},0.22)`); rg.addColorStop(1, `rgba(${sky.top},0)`);
    x.fillStyle = rg; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // faint stars, crowded towards the band
  x.globalCompositeOperation = "lighter";
  for (let i = 0; i < 2600; i++) {
    let px = Math.random() * W, py = Math.random() * H;
    if (Math.random() < 0.55) { const k = Math.random(); px = bx0 + (bx1 - bx0) * k + (Math.random() - 0.5) * 0.25 * H; py = by0 + (by1 - by0) * k + (Math.random() - 0.5) * 0.25 * H; }
    const m = Math.pow(Math.random(), 3), sz = (0.5 + m * 1.6) * sc;
    const tint = Math.random() < 0.2 ? "255,214,180" : Math.random() < 0.3 ? "190,210,255" : "235,240,255";
    x.fillStyle = `rgba(${tint},${0.25 + m * 0.7})`;
    x.fillRect(px, py, sz, sz);
  }
  return c;
}

const COLORS = {
  silver: { glow: [150, 185, 255], core: [238, 244, 255], tint: [12, 22, 80] },
  gold:   { glow: [255, 196, 100], core: [255, 244, 222], tint: [40, 25, 70] },
  rose:   { glow: [255, 140, 200], core: [255, 234, 246], tint: [45, 15, 70] },
};

// Constellation names: silly on purpose. Every one carries the same subtitle.
const SUBTITLE = "— An Array of Stars —";
const SILLY_NAMES = [
  "The Chork", "The Dwingle", "The Dorkus", "The Krundle", "SG0001", "Deez", "??? WHO KNOWS ???",
  "Lil Baby Star", "Yo Mama", "The Big Smoosh", "Gerald", "Snorbo", "The Flonk", "Mega Blorp",
  "Sir Twinkles McGee", "Pointy Boi", "Thursday", "The Schnoz", "Bingus", "Chonk Major", "Chonk Minor",
  "Gary From Accounts", "The Zorp", "Space Potato", "Noodle Arm", "The Wobbler", "Unnamed Nugget",
  "Big Dipper's Cousin", "The Grumbus", "Spaghetto", "Lord Sparkle", "The Hork", "Meatball Prime",
  "Kevin", "Sneeb", "The Blob That Ate Ohio", "Clumsy Gus",
];
// Deals names in a shuffled order with no repeats. After a full round they come back as "II", "III"...
function makeName(taken) {
  const fresh = SILLY_NAMES.filter(n => !taken.has(n));
  if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
  for (let round = 2; ; round++) {
    const roman = ["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][round] || String(round);
    const left = SILLY_NAMES.map(n => `${n} ${roman}`).filter(n => !taken.has(n));
    if (left.length) return left[Math.floor(Math.random() * left.length)];
  }
}
// C major pentatonic, two octaves: every combination sounds pleasant
const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1567.98, 1760];
const MAX_STARS = 40;

export default {
  id: "star-map",
  name: "Star Map",
  blurb: "Pinch to place stars, point to link them into constellations. Two fists clear the sky.",
  voice: { pitch: 1.12, electric: 0, mix: 0.45 },
  settings: [
    { key: "color", label: "Starlight", type: "select", options: [["silver", "Silver"], ["gold", "Gold"], ["rose", "Rose"]], default: "silver" },
    { key: "sky", label: "Night sky", type: "range", min: 0, max: 1, step: 0.05, default: 1, format: v => `${Math.round(v * 100)}%` },
    { key: "nightAfter", label: "Constellations to full night", type: "range", min: 1, max: 8, step: 1, default: 4, format: v => `${v}` },
    { key: "grab", label: "Star reach", type: "range", min: 0.3, max: 1.5, step: 0.05, default: 0.7, format: v => `${Math.round(v * 100)}%` },
    { key: "names", label: "Name constellations", type: "toggle", default: true },
  ],
  idleSteps: ["idle", "stars", "named"],
  steps: [
    { id: "idle", label: "Pinch to place a star" },
    { id: "stars", label: "Point at a star, sweep to others to link" },
    { id: "drawing", label: "Linking stars" },
    { id: "named", label: "Constellation named" },
  ],

  create(kit) {
    const S = kit.settings;
    const holds = new kit.Holds();
    const sparks = new Particles(400);
    const colors = () => COLORS[S.color] || COLORS.silver;

    let stars = [], edges = [], groups = [], nextId = 1;
    const usedNames = new Set();
    let chain = null;                 // { from: star, links: n } while pointing
    let pointerLost = 0;
    const slots = [{ since: null, drag: null, seen: 0 }, { since: null, drag: null, seen: 0 }];
    let sky = 0, voice = 0, celebrateUntil = 0, clearing = null, lastTip = null, noteIdx = 0;
    // brighter stars that twinkle (the faint ones are painted once into the sky)
    const field = Array.from({ length: 150 }, () => ({ x: Math.random(), y: Math.random() * 0.85, s: rand(0.4, 1.4), p: rand(0, 6.28), f: rand(0.6, 2) }));
    let skyBase = null, skyKey = "", meteor = null, nextMeteor = 0;
    // How far into night: a little once you start placing stars, then a step deeper per constellation.
    const skyTarget = () => {
      if (!stars.length) return 0;
      return S.sky * Math.min(1, 0.12 + 0.88 * groups.length / Math.max(1, S.nightAfter));
    };
    const cut = () => kit.cutout && kit.cutout.ready;

    const grabR = W => 70 * S.grab * (W / 1280);
    const nearest = (p, R, except) => {
      let best = null, bd = R;
      for (const s of stars) { if (s === except) continue; const d = dist(p, s); if (d < bd) { bd = d; best = s; } }
      return best;
    };
    const linked = (a, b) => edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    const noteFor = y => NOTES[clamp(Math.round((1 - y / kit.view.H) * (NOTES.length - 1)), 0, NOTES.length - 1)];

    function addStar(x, y, t) {
      const s = { id: nextId++, x, y, born: t, seed: rand(0, 1000), pulse: 0, group: null };
      stars.push(s);
      if (stars.length > MAX_STARS) removeStar(stars[0]);
      for (let i = 0; i < 18; i++) sparks.emit(x, y, { speed: [60, 260], gravity: 0, drag: 0.94, life: [0.3, 0.8] });
      kit.sfx.play("chime", noteFor(y), 0.11);
      kit.emit("star_placed", `${stars.length} star${stars.length === 1 ? "" : "s"}`);
      return s;
    }
    function removeStar(s) {
      stars = stars.filter(x => x !== s);
      edges = edges.filter(e => e.a !== s && e.b !== s);
    }

    function component(start) {
      const seen = new Set([start]), q = [start];
      while (q.length) {
        const s = q.pop();
        for (const e of edges) {
          const o = e.a === s ? e.b : e.b === s ? e.a : null;
          if (o && !seen.has(o)) { seen.add(o); q.push(o); }
        }
      }
      return [...seen];
    }

    function finishChain(t) {
      if (!chain) return;
      const made = chain.links;
      const members = component(chain.from);
      chain = null;
      if (made === 0 || members.length < 3) return;
      // join an existing constellation if these stars touch one; otherwise name a new one
      let g = members.map(s => s.group).find(Boolean);
      const isNew = !g;
      if (isNew) {
        const name = makeName(usedNames); usedNames.add(name);
        g = { name, born: t };
        groups.push(g);
      }
      for (const s of members) { s.group = g; s.pulse = 1; }
      celebrateUntil = t + 3000;
      const base = noteFor(members.reduce((a, s) => a + s.y, 0) / members.length);
      const i0 = Math.max(0, NOTES.indexOf(base) - 2);
      [0, 2, 4, 5].forEach((k, j) => kit.sfx.play("chime", NOTES[Math.min(NOTES.length - 1, i0 + k)], 0.1, j * 0.11));
      kit.emit(isNew ? "constellation_named" : "constellation_grew", `${g.name} · ${members.length} stars`);
      if (isNew) kit.emit("voice_on");
    }

    function clearSky(t) {
      if (!stars.length) return;
      clearing = { born: t, stars, edges, groups };
      stars = []; edges = []; groups = []; chain = null;
      slots.forEach(s => { s.drag = null; s.since = null; });
      kit.sfx.play("whoosh", 0.45, 1.1);
      kit.emit("sky_cleared");
    }

    return {
      get step() { return chain ? "drawing" : performance.now() < celebrateUntil ? "named" : stars.length ? "stars" : "idle"; },
      get progress() { return holds.frac("clear", 900, performance.now()); },
      get coach() {
        if (chain) return "Sweep to more stars. Lower your finger to finish";
        if (!stars.length) return "Pinch your thumb and finger to place a star";
        if (stars.length < 3) return "Place a few more stars, then point to link them";
        return "Point to link stars · pinch to add or move · two fists to clear";
      },
      get voice() { return voice; },

      update(f) {
        const { t, dt, hands, W } = f;
        const R = grabR(W);

        // 1. pinching: place or move stars (one slot per hand)
        slots.forEach((slot, i) => {
          const h = hands[i];
          const pinching = h && h.pinch && !h.fist;
          const at = pinching ? { x: (h.P[4].x + h.P[8].x) / 2, y: (h.P[4].y + h.P[8].y) / 2 } : null;
          if (pinching) {
            slot.seen = t;
            if (slot.drag) {
              slot.drag.x += (at.x - slot.drag.x) * 0.6; slot.drag.y += (at.y - slot.drag.y) * 0.6;
            } else {
              if (slot.since == null) slot.since = t;
              if (t - slot.since > 120) {
                const hit = nearest(at, R * 0.8);
                slot.drag = hit || addStar(at.x, at.y, t);
                if (hit) { hit.pulse = 0.6; kit.sfx.play("chime", noteFor(hit.y) * 2, 0.05); }
              }
            }
          } else if (t - slot.seen > 140) {
            slot.since = null; slot.drag = null;
          }
        });

        // 2. pointing: link stars
        const pointer = hands.find(h => h.point && !h.pinch);
        if (pointer) {
          pointerLost = 0;
          lastTip = pointer.tip;
          if (!chain) {
            const s = nearest(pointer.tip, R);
            if (s) { chain = { from: s, links: 0 }; s.pulse = 0.7; noteIdx = NOTES.indexOf(noteFor(s.y)); kit.sfx.play("chime", NOTES[noteIdx], 0.07); }
          } else {
            const s = nearest(pointer.tip, R, chain.from);
            if (s && !linked(chain.from, s)) {
              edges.push({ a: chain.from, b: s, born: t });
              chain.from = s; chain.links++; s.pulse = 0.8;
              noteIdx = (noteIdx + 1) % NOTES.length;
              kit.sfx.play("chime", NOTES[noteIdx], 0.09);
              for (let k = 0; k < 10; k++) sparks.emit(s.x, s.y, { speed: [40, 180], gravity: 0, drag: 0.93, life: [0.2, 0.6] });
            } else if (s && s !== chain.from) {
              chain.from = s;  // already linked: just hop along without a new line
            }
          }
        } else if (chain) {
          pointerLost += dt;
          if (pointerLost > 0.25) finishChain(t);
        }

        // 3. two fists held: clear the sky
        const fists = hands.length >= 2 && hands[0].fist && hands[1].fist;
        if (holds.held("clear", fists && stars.length > 0, 900, t)) { holds.clear("clear"); clearSky(t); }

        // levels
        // fades in slowly (a few seconds per constellation), back out a bit faster when cleared
        sky = approach(sky, skyTarget(), 0.12, 0.35, dt);
        voice = approach(voice, t < celebrateUntil ? 1 : 0, 2, 0.8, dt);
        for (const s of stars) s.pulse = Math.max(0, s.pulse - dt * 1.2);
        if (clearing && t - clearing.born > 1400) clearing = null;
        sparks.update(dt);
      },

      grade() {
        const c = colors();
        // With the cut-out, this only lights you for night time; the room itself is replaced by the sky.
        // Without it, the whole picture just dims.
        return cut()
          ? { darken: sky * 0.22, desaturate: sky * 0.2, contrast: sky * 0.05, tint: c.tint, tintAmount: sky * 0.3, vignette: sky * 0.35, shake: 0 }
          : { darken: sky * 0.55, desaturate: sky * 0.4, contrast: sky * 0.06, tint: c.tint, tintAmount: sky * 0.45, vignette: sky * 0.75, shake: 0 };
      },

      // The engine fades this in behind you (needs the person cut-out).
      get backdropAmount() { return kit.cutout && kit.cutout.failed ? 0 : sky; },
      backdrop(ctx, f) {
        const { t, W, H } = f, sc = W / 1280, c = colors();
        const key = `${W}x${H}:${S.color}`;
        if (key !== skyKey) { skyBase = paintSkyBase(W, H, SKIES[S.color] || SKIES.silver); skyKey = key; }
        ctx.drawImage(skyBase, 0, 0);
        ctx.globalCompositeOperation = "lighter";
        for (const s of field) {
          const a = (0.35 + 0.45 * Math.sin(t * 0.0012 * s.f + s.p)) * s.s;
          if (a <= 0.03) continue;
          glowDot(ctx, s.x * W, s.y * H, 4.5 * sc * s.s, c.glow, 0.35 * a);
          ctx.globalAlpha = Math.min(1, a); ctx.fillStyle = `rgb(${c.core.join(",")})`;
          ctx.fillRect(s.x * W - sc, s.y * H - sc, 2 * sc * s.s, 2 * sc * s.s);
        }
        ctx.globalAlpha = 1;
        // the occasional shooting star, once the sky is properly dark
        if (!meteor && sky > 0.6 && t > nextMeteor) {
          if (nextMeteor) meteor = { x: rand(0.15, 0.85) * W, y: rand(0.05, 0.3) * H, vx: rand(-1, 1) < 0 ? -1 : 1, born: t };
          nextMeteor = t + rand(7000, 14000);
        }
        if (meteor) {
          const k = (t - meteor.born) / 700;
          if (k >= 1) meteor = null;
          else {
            const L = 160 * sc, hx = meteor.x + meteor.vx * k * 420 * sc, hy = meteor.y + k * 180 * sc;
            const tx = hx - meteor.vx * L * 0.92, ty = hy - L * 0.39, a = Math.sin(k * Math.PI);
            const g = ctx.createLinearGradient(tx, ty, hx, hy);
            g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, `rgba(255,255,255,${0.9 * a})`);
            ctx.strokeStyle = g; ctx.lineWidth = 2 * sc; ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
            glowDot(ctx, hx, hy, 10 * sc, c.glow, 0.6 * a);
          }
        }
        ctx.globalCompositeOperation = "source-over";
      },

      draw(ctx, f) {
        const { t, W, H } = f;
        const c = colors();
        const sc = W / 1280;
        ctx.globalCompositeOperation = "lighter";

        // fallback star field over the picture, if the cut-out isn't available
        if (sky > 0.02 && !cut()) {
          ctx.fillStyle = `rgb(${c.core.join(",")})`;
          for (const s of field) {
            const a = sky * (0.25 + 0.35 * Math.sin(t * 0.001 * s.f + s.p)) * s.s;
            if (a <= 0.02) continue;
            ctx.globalAlpha = Math.min(1, a);
            ctx.fillRect(s.x * W, s.y * H, 1.6 * sc * s.s, 1.6 * sc * s.s);
          }
          ctx.globalAlpha = 1;
        }

        const drawEdges = (list, fade, drift) => {
          for (const e of list) {
            const k = clamp((t - e.born) / 280);
            const ax = e.a.x, ay = e.a.y - drift, bx = ax + (e.b.x - ax) * k, by = ay + (e.b.y - drift - ay) * k;
            const glowing = e.a.group && t - e.a.group.born < 3000 ? 1 : 0;
            ctx.lineCap = "round";
            ctx.strokeStyle = `rgba(${c.glow.join(",")},${(0.2 + 0.2 * glowing) * fade})`;
            ctx.lineWidth = 7 * sc;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
            ctx.strokeStyle = `rgba(${c.core.join(",")},${0.85 * fade})`;
            ctx.lineWidth = 1.8 * sc;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          }
        };
        const drawStars = (list, fade, drift) => {
          for (const s of list) {
            const tw = 0.78 + 0.22 * Math.sin(t * 0.004 + s.seed);
            const grow = clamp((t - s.born) / 250);
            const r = 4.5 * sc * (1 + s.pulse * 0.8) * grow;
            const x = s.x, y = s.y - drift;
            glowDot(ctx, x, y, r * 9, c.glow, 0.32 * tw * fade);
            glowDot(ctx, x, y, r * 2.4, c.core, 0.95 * fade);
            // four-point flare
            ctx.strokeStyle = `rgba(${c.core.join(",")},${0.55 * tw * fade})`;
            ctx.lineWidth = 1.2 * sc;
            const L = r * (6 + 3 * tw), l = L * 0.45;
            ctx.beginPath();
            ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L);
            ctx.moveTo(x - l * 0.6, y - l * 0.6); ctx.lineTo(x + l * 0.6, y + l * 0.6);
            ctx.moveTo(x - l * 0.6, y + l * 0.6); ctx.lineTo(x + l * 0.6, y - l * 0.6);
            ctx.stroke();
          }
        };

        drawEdges(edges, 1, 0);
        // the line you're drawing right now, from the last star to your fingertip
        if (chain && lastTip) {
          ctx.setLineDash([6 * sc, 8 * sc]);
          ctx.strokeStyle = `rgba(${c.core.join(",")},0.55)`;
          ctx.lineWidth = 1.6 * sc;
          ctx.beginPath(); ctx.moveTo(chain.from.x, chain.from.y); ctx.lineTo(lastTip.x, lastTip.y); ctx.stroke();
          ctx.setLineDash([]);
          glowDot(ctx, lastTip.x, lastTip.y, 22 * sc, c.glow, 0.5);
        }
        drawStars(stars, 1, 0);

        // cleared sky drifts up and fades
        if (clearing) {
          const k = clamp((t - clearing.born) / 1400);
          drawEdges(clearing.edges, 1 - k, k * k * 160 * sc);
          drawStars(clearing.stars, 1 - k, k * k * 160 * sc);
        }

        sparks.draw(ctx, "ember", c);
      },

      // Constellation names. Drawn by the engine as text, separately for your screen and for the call,
      // so they read the right way round in both (calls receive the picture un-mirrored).
      labels(f) {
        if (!S.names) return [];
        const c = colors(), sc = f.W / 1280, out = [];
        for (const g of groups) {
          const mem = stars.filter(s => s.group === g);
          if (!mem.length) continue;
          const a = clamp((f.t - g.born) / 900);
          const cx = mem.reduce((acc, s) => acc + s.x, 0) / mem.length;
          const top = Math.min(...mem.map(s => s.y));
          out.push({ text: g.name, sub: SUBTITLE, x: cx, y: Math.max(64 * sc, top - 48 * sc - (1 - a) * 12 * sc), size: 30 * sc, alpha: a, color: c.core, glow: c.glow });
        }
        return out;
      },

      // screen-only: show how close you need to be to grab a star while pointing
      overlay(ctx, f) {
        if (!lastTip || !f.hands.some(h => h.point)) return;
        const R = grabR(f.W);
        ctx.save();
        ctx.strokeStyle = "rgba(214,221,232,.25)"; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        for (const s of stars) { ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
      },

      // Space: draw a demo constellation
      trigger(f) {
        const { W, H, t } = f;
        const pts = [[0.3, 0.3], [0.4, 0.2], [0.5, 0.32], [0.6, 0.18], [0.7, 0.28]];
        const made = pts.map(([x, y], i) => { const s = addStar(x * W, y * H, t + i * 60); return s; });
        for (let i = 1; i < made.length; i++) edges.push({ a: made[i - 1], b: made[i], born: t + i * 120 });
        chain = { from: made[made.length - 1], links: made.length - 1 };
        finishChain(t);
      },
      reset(f) { clearSky(f.t); },
      dispose() {},
    };
  },
};
