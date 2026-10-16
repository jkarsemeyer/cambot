// Sends the finished picture to "CAMBOT Camera", the virtual webcam that call apps can pick.
// Only available in the desktop app (the Electron preload provides window.cambot.camera).

import { drawLabels } from "./draw.js";

const bridge = window.cambot && window.cambot.camera;
const W = 1280, H = 720;          // what call apps receive; must be multiples of 4
const FRAME_MS = 1000 / 30;

let canvas = null, ctx = null, bgr = null, bgrx = null, last = 0, running = false, inFlight = false;
// Fast path: read the frame back from the graphics card asynchronously (VideoFrame.copyTo), so the
// page never stalls waiting for it. Falls back to the older blocking read if the browser can't.
let asyncRead = typeof VideoFrame === "function";

function makeCanvas() {
  canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  // The async path keeps this canvas on the graphics card; the fallback reads it back every frame.
  ctx = canvas.getContext("2d", asyncRead ? { alpha: false } : { alpha: false, willReadFrequently: true });
}

// BGRX (4 bytes per pixel) → BGR (3 bytes), which is what CAMBOT Camera takes.
function packBGRX(src) {
  for (let i = 0, j = 0, n = src.length; i < n; i += 4, j += 3) {
    bgr[j] = src[i]; bgr[j + 1] = src[i + 1]; bgr[j + 2] = src[i + 2];
  }
}

export const vcam = {
  available: !!bridge,
  width: W,
  height: H,

  // { installed, path?, detail? } from the desktop app
  async status() {
    if (!bridge) return { installed: false, detail: "Virtual camera is only in the desktop app" };
    return bridge.status();
  },

  async install() { return bridge ? bridge.install() : { ok: false, detail: "Desktop app only" }; },

  start() {
    if (!bridge) return false;
    if (running) return true;
    makeCanvas();
    bgr = new Uint8Array(W * H * 3);
    bgrx = new Uint8Array(W * H * 4);
    running = bridge.start(W, H);
    return running;
  },

  stop() {
    if (bridge && running) bridge.stop();
    running = false;
  },

  get running() { return running; },
  connected() { return running && bridge.isConnected(); },

  // Call once per animation frame with the clean output canvas.
  // unmirror: the screen view is mirrored like a mirror; call apps expect the true image and mirror it themselves.
  // labels: effect text in picture coordinates, drawn after un-mirroring so it reads the right way round.
  // readable: a canvas the size of the picture, drawn on top WITHOUT un-mirroring (air-drawn writing).
  send(source, now, unmirror, labels, readable) {
    if (!running || inFlight || now - last < FRAME_MS - 2) return;
    last = now;
    // fill 16:9, cropping the source if it's a different shape
    const sw = source.width, sh = source.height;
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.setTransform(unmirror ? -1 : 1, 0, 0, 1, unmirror ? W : 0, 0);
    ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (readable) ctx.drawImage(readable, (W - dw) / 2, (H - dh) / 2, dw, dh);
    if (labels && labels.length) {
      const ox = (W - dw) / 2, oy = (H - dh) / 2;
      drawLabels(ctx, labels, p => ({ x: unmirror ? W - (ox + p.x * scale) : ox + p.x * scale, y: oy + p.y * scale }), scale);
    }

    if (asyncRead) {
      inFlight = true;
      let vf;
      try { vf = new VideoFrame(canvas, { timestamp: Math.round(now * 1000) }); }
      catch (e) { inFlight = false; asyncRead = false; makeCanvas(); console.warn("CAMBOT Camera: async frame read unavailable", e); return; }
      vf.copyTo(bgrx, { format: "BGRX", colorSpace: "srgb" })
        .then(() => { if (running) { packBGRX(bgrx); bridge.send(bgr); } })
        .catch(e => { asyncRead = false; makeCanvas(); console.warn("CAMBOT Camera: async frame read failed, using the slower path", e); })
        .finally(() => { vf.close(); inFlight = false; });
      return;
    }

    const rgba = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      bgr[j] = rgba[i + 2];
      bgr[j + 1] = rgba[i + 1];
      bgr[j + 2] = rgba[i];
    }
    bridge.send(bgr);
  },
};
