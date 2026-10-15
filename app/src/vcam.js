// Sends the finished picture to "CAMBOT Camera", the virtual webcam that call apps can pick.
// Only available in the desktop app (the Electron preload provides window.cambot.camera).

const bridge = window.cambot && window.cambot.camera;
const W = 1280, H = 720;          // what call apps receive; must be multiples of 4
const FRAME_MS = 1000 / 30;

let canvas = null, ctx = null, bgr = null, last = 0, running = false;

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
    canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    bgr = new Uint8Array(W * H * 3);
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
  send(source, now, unmirror) {
    if (!running || now - last < FRAME_MS) return;
    last = now;
    // fill 16:9, cropping the source if it's a different shape
    const sw = source.width, sh = source.height;
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.setTransform(unmirror ? -1 : 1, 0, 0, 1, unmirror ? W : 0, 0);
    ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const rgba = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      bgr[j] = rgba[i + 2];
      bgr[j + 1] = rgba[i + 1];
      bgr[j + 2] = rgba[i];
    }
    bridge.send(bgr);
  },
};
