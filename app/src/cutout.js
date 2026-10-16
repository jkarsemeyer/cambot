// Person cut-out: separates you from the room, so an effect can replace the background and keep you in
// front of it. The mask comes from the "segment" tracking worker, which only runs while something needs it.
//
// An effect asks for this by having   get backdropAmount() (0..1)   and   backdrop(ctx, f)   which paints
// the new background over the whole frame. The engine fades it in by backdropAmount, behind you.

let maskCanvas = null, seen = -1e9, person = null, sky = null;

const sized = (c, W, H) => { if (!c || c.width !== W || c.height !== H) { c = document.createElement("canvas"); c.width = W; c.height = H; } return c; };

export const cutout = {
  failed: false,

  // A mask from the worker: { mask: Uint8ClampedArray (0..255 per pixel, 255 = you), w, h }
  setMask(m) {
    if (!m) return;
    maskCanvas = sized(maskCanvas, m.w, m.h);
    const mctx = maskCanvas.getContext("2d");
    const img = mctx.createImageData(m.w, m.h);
    for (let i = 0, j = 3; i < m.mask.length; i++, j += 4) img.data[j] = m.mask[i];
    mctx.putImageData(img, 0, 0);
    seen = performance.now();
  },

  get ready() { return !!maskCanvas && performance.now() - seen < 1500; },

  // ctx holds the finished camera picture. Paints paint(skyCtx, f) behind you at `amount`.
  // mirrored: whether the picture is mirrored (the mask is always in true camera orientation).
  replaceBackground(ctx, f, amount, paint, mirrored) {
    if (amount <= 0.003 || !this.ready) return false;
    const { W, H } = f;
    person = sized(person, W, H);
    sky = sized(sky, W, H);
    const pctx = person.getContext("2d"), sctx = sky.getContext("2d");

    // you, cut out of the current picture (soft edge)
    pctx.globalCompositeOperation = "source-over";
    pctx.clearRect(0, 0, W, H);
    pctx.drawImage(ctx.canvas, 0, 0);
    pctx.globalCompositeOperation = "destination-in";
    pctx.filter = `blur(${Math.max(1.5, W / 520).toFixed(1)}px)`;
    pctx.save();
    if (mirrored) { pctx.translate(W, 0); pctx.scale(-1, 1); }
    pctx.drawImage(maskCanvas, 0, 0, W, H);
    pctx.restore();
    pctx.filter = "none";

    // the new background
    sctx.globalCompositeOperation = "source-over";
    sctx.globalAlpha = 1;
    sctx.clearRect(0, 0, W, H);
    paint(sctx, f);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.globalAlpha = Math.min(1, amount);
    ctx.drawImage(sky, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(person, 0, 0);
    ctx.restore();
    return true;
  },
};
