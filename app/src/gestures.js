// Turns raw tracking points into things effects can use: where each hand is, whether it's a fist,
// an open palm or a pinch, and where the eyes are.

import { dist, clamp } from "./util.js";

const FINGERS = [[8, 6, 5], [12, 10, 9], [16, 14, 13], [20, 18, 17]]; // tip, middle joint, knuckle

export function toPx(p, view) {
  return { x: (view.mirror ? 1 - p.x : p.x) * view.W, y: p.y * view.H };
}

/*
  Each hand:
    P        21 points in canvas pixels (0 wrist, 4 thumb tip, 8 index tip, 12 middle tip, 16 ring tip, 20 pinky tip)
    palm     centre of the palm
    size     wrist-to-middle-knuckle distance, a good unit for scaling effects to the hand
    fist     at least 3 fingers curled
    open     all 4 fingers extended
    pinch    thumb tip touching index tip
    ext      [index, middle, ring, pinky] each true if that finger is extended
    curl     [index, middle, ring, pinky] each true if that finger is curled
    thumb    thumb sticking out from the hand
    point    index finger out, the others curled (thumb can be either way)
    L        thumb and index out, the others curled: one corner of a finger frame
    peace    index and middle out, ring and pinky curled
    thumbsUp thumb out and pointing up, the four fingers curled
    upright  open hand with the fingers pointing up (within about 30 degrees)
    tip      index fingertip
    x01,y01  palm position as a fraction of the frame (0 = left/top)
  Hands are sorted left to right as they appear on screen.
*/
export function readHands(result, view) {
  const out = [];
  if (!result || !result.landmarks) return out;
  for (const lm of result.landmarks) {
    const P = lm.map(p => toPx(p, view));
    const wrist = P[0];
    const palm = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + P[i].x / 5, y: a.y + P[i].y / 5 }), { x: 0, y: 0 });
    const size = Math.max(1, dist(P[0], P[9]));
    const ext = [], curl = [];
    for (const [tip, pip, mcp] of FINGERS) {
      const dT = dist(P[tip], wrist), dP = dist(P[pip], wrist), dM = dist(P[mcp], wrist);
      curl.push(dT < dP * 1.0 || dT < dM * 1.25);
      ext.push(!curl[curl.length - 1] && dT > dP * 1.2 && dT > dM * 1.55);
    }
    const curled = curl.filter(Boolean).length, extended = ext.filter(Boolean).length;
    // A pointing finger isn't a fist, even though the other three fingers are curled.
    const fist = curled >= 3 && !ext[0];
    const open = !fist && extended >= 4;
    const pinch = dist(P[4], P[8]) < size * 0.32;
    // thumb is "out" when its tip is well away from the index knuckle and further from the wrist than its own joint
    const thumb = dist(P[4], P[5]) > size * 0.55 && dist(P[4], wrist) > dist(P[3], wrist);
    const othersCurled = [curl[1], curl[2], curl[3]].filter(Boolean).length >= 2;
    const point = ext[0] && othersCurled && !ext[1];
    const L = point && thumb;
    const peace = ext[0] && ext[1] && curl[2] && curl[3];
    const thumbsUp = thumb && curled >= 4 && P[4].y < P[2].y - size * 0.45 && !pinch;
    const up = Math.atan2(P[9].x - wrist.x, wrist.y - P[9].y); // 0 = fingers straight up
    const upright = open && Math.abs(up) < 0.55;
    out.push({ P, palm, size, fist, open, pinch, curled, extended, ext, curl, thumb, point, L, peace, thumbsUp, upright, tip: P[8], x01: palm.x / view.W, y01: palm.y / view.H });
  }
  out.sort((a, b) => a.palm.x - b.palm.x);
  return out;
}

/*
  Face:
    eyes   two eyes, each { c: centre, r: iris radius, open: 0 closed .. 1 open }
    roll   head tilt in radians
    mouthOpen  0 closed .. 1 wide open
    P      all 478 points in canvas pixels
*/
export function readFace(result, view) {
  if (!result || !result.faceLandmarks || !result.faceLandmarks.length) return null;
  const P = result.faceLandmarks[0].map(p => toPx(p, view));
  if (P.length < 478) return null;
  const eye = (c, ring, top, bot, a, b) => {
    const r = ring.reduce((s, i) => s + dist(P[c], P[i]), 0) / ring.length;
    const open = clamp((dist(P[top], P[bot]) / Math.max(1, dist(P[a], P[b])) - 0.09) / 0.12);
    return { c: P[c], r: Math.max(2, r), open };
  };
  const eyes = [
    eye(468, [469, 470, 471, 472], 159, 145, 33, 133),
    eye(473, [474, 475, 476, 477], 386, 374, 362, 263),
  ];
  let roll = Math.atan2(P[263].y - P[33].y, P[263].x - P[33].x);
  if (Math.abs(roll) > Math.PI / 2) roll -= Math.PI * Math.sign(roll);
  const faceH = Math.max(1, dist(P[10], P[152]));
  const mouthOpen = clamp((dist(P[13], P[14]) / faceH - 0.02) / 0.12);
  return { eyes, roll, mouthOpen, P, faceH };
}
