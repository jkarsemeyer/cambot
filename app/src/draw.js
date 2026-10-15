// Drawing kit shared by effects: glows, lightning, particles, glowing eyes.
// Glows look best with ctx.globalCompositeOperation = "lighter" (light adds up like real light).

import { dist, rand, rgba } from "./util.js";

export function glowDot(ctx, x, y, r, col, a) {
  if (a <= 0.003 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Jagged line between two points by repeated midpoint displacement.
export function boltPath(x1, y1, x2, y2, disp, iters = 6) {
  let pts = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  let d = disp;
  for (let k = 0; k < iters; k++) {
    const np = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.max(1, dist(a, b));
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      const o = (Math.random() - 0.5) * d;
      np.push({ x: (a.x + b.x) / 2 + nx * o, y: (a.y + b.y) / 2 + ny * o }, b);
    }
    pts = np;
    d *= 0.55;
  }
  return pts;
}

// A lightning bolt with branches: [{ pts, w }]
export function makeBolt(x1, y1, x2, y2, width = 3, branches = 4) {
  const L = Math.hypot(x2 - x1, y2 - y1);
  const main = boltPath(x1, y1, x2, y2, L * 0.28);
  const segs = [{ pts: main, w: width }];
  const ang0 = Math.atan2(y2 - y1, x2 - x1);
  for (let i = 0; i < branches; i++) {
    const p = main[Math.floor(rand(0.15, 0.8) * main.length)];
    const ang = ang0 + rand(-0.9, 0.9);
    const len = L * rand(0.12, 0.3);
    segs.push({ pts: boltPath(p.x, p.y, p.x + Math.cos(ang) * len, p.y + Math.sin(ang) * len, len * 0.45, 5), w: width * 0.4 });
  }
  return segs;
}

export function strokeBolt(ctx, segs, alpha, colors) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const passes = [[7, 0.1, colors.glow], [3, 0.35, colors.glow], [1, 1, colors.core]];
  for (const [mul, a, col] of passes) {
    ctx.strokeStyle = rgba(col, a * alpha);
    for (const s of segs) {
      ctx.lineWidth = Math.max(0.6, s.w * mul);
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.stroke();
    }
  }
}

/*
  Simple particle system.
    emit(x, y, { speed, angle, spread, life, gravity, size, drag, rise })
    style "spark": bright streaks; "ember": soft glowing dots; "smoke": grey puffs (draw with source-over)
*/
export class Particles {
  constructor(max = 800) { this.list = []; this.max = max; }
  emit(x, y, o = {}) {
    const ang = (o.angle ?? rand(0, Math.PI * 2)) + rand(-(o.spread ?? Math.PI), o.spread ?? Math.PI);
    const v = rand(o.speed?.[0] ?? 100, o.speed?.[1] ?? 400);
    this.list.push({
      x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
      age: 0, life: rand(o.life?.[0] ?? 0.3, o.life?.[1] ?? 0.8),
      g: o.gravity ?? 700, drag: o.drag ?? 0.98, size: rand(o.size?.[0] ?? 1.5, o.size?.[1] ?? 2.5),
      seed: Math.random() * 1000,
    });
    if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max);
  }
  update(dt) {
    for (const p of this.list) {
      p.age += dt;
      p.vy += p.g * dt;
      p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.list = this.list.filter(p => p.age < p.life);
  }
  draw(ctx, style, colors) {
    for (const p of this.list) {
      const a = 1 - p.age / p.life;
      if (style === "spark") {
        ctx.strokeStyle = rgba(colors.core, a);
        ctx.lineWidth = p.size * 0.7;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke();
      } else if (style === "ember") {
        const wob = Math.sin(p.seed + p.age * 9) * 1.5;
        glowDot(ctx, p.x + wob, p.y, p.size * 4, colors.glow, 0.5 * a);
        glowDot(ctx, p.x + wob, p.y, p.size * 1.2, colors.core, a);
      } else if (style === "smoke") {
        const r = p.size * (6 + p.age * 30);
        ctx.fillStyle = `rgba(120,120,125,${0.18 * a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

// Glowing eyes with a lens-flare streak that follows head tilt. level 0..1.
export function drawEyes(ctx, face, level, colors, flare = 1) {
  if (!face || level <= 0.01) return;
  for (const e of face.eyes) {
    const L = level * (0.55 + 0.45 * e.open) * (0.9 + Math.random() * 0.1);
    const { x, y } = e.c, r = e.r;
    glowDot(ctx, x, y, r * 10, colors.glow, 0.45 * L);
    if (flare > 0) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(face.roll); ctx.scale(1, 0.07);
      glowDot(ctx, 0, 0, r * 22 * flare * (0.6 + 0.4 * level), colors.glow, 0.55 * L);
      ctx.restore();
      ctx.save(); ctx.translate(x, y); ctx.rotate(face.roll); ctx.scale(0.12, 1);
      glowDot(ctx, 0, 0, r * 7, colors.core, 0.35 * L);
      ctx.restore();
    }
    glowDot(ctx, x, y, r * 2.2, colors.core, 0.95 * L);
    glowDot(ctx, x, y, r * 1.1, [255, 255, 255], L);
  }
}

export function vignette(ctx, W, H, a) {
  if (a <= 0.01) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// Bones of the hand skeleton, for the "show tracking points" view.
export const HAND_BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
