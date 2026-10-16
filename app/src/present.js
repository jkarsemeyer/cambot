// Present: your slides become the background, with you cut out in front of them.
//
// Slides come from a Google Slides link (downloaded as a PDF by the desktop app) or a PDF you open.
// Entering and leaving is a card turn: the picture turns over like a card, and the back has you in
// front of your slides. Halfway through the turn the picture stops being mirrored, so slides read
// the right way round for you and for the call, and the switch is hidden by the turn.

import { clamp } from "./util.js";

const TURN_MS = 900, SLIDE_MS = 420;
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.mjs", document.baseURI).href;
  return pdfjs;
}

// The deck id from any Google Slides link: .../presentation/d/<id>/edit...
export function slidesIdFrom(link) {
  const m = String(link || "").match(/\/presentation\/(?:u\/\d+\/)?d\/(?:e\/)?([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}

export function createPresenter({ emit, fetchSlidesPdf }) {
  let doc = null, deckName = "", pages = 0;
  const cache = new Map();                 // page number → ImageBitmap
  let index = 0;
  let on = false;                          // presenting (target state)
  let turn = null;                         // { from, to, start } while the card turns
  let back = false;                        // showing the back of the card (slides behind you)
  let slideFx = null;                      // { from: bitmap, dir, start } while changing slides
  let mask = null, maskCanvas = null, mctx = null, maskSeen = 0;
  let person = null, pctx = null, tmp = null, tctx = null;

  const canvas = (w, h, c) => { if (!c || c.width !== w || c.height !== h) { c = document.createElement("canvas"); c.width = w; c.height = h; } return c; };

  async function render(n) {
    if (cache.has(n)) return cache.get(n);
    const page = await doc.getPage(n + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = 1600 / vp1.width;                       // render crisp, then scale to the frame
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    const bmp = await createImageBitmap(c);
    cache.set(n, bmp);
    // keep memory down: only hold slides near the current one
    for (const [k, b] of cache) if (Math.abs(k - index) > 3) { b.close(); cache.delete(k); }
    return bmp;
  }
  const prefetch = () => { for (const n of [index, index + 1, index - 1]) if (doc && n >= 0 && n < pages) render(n).catch(() => {}); };

  async function openPdf(data, name) {
    const lib = await loadPdfjs();
    const d = await lib.getDocument({ data, standardFontDataUrl: new URL("vendor/pdfjs/standard_fonts/", document.baseURI).href }).promise;
    if (doc) { for (const b of cache.values()) b.close(); cache.clear(); doc.destroy(); }
    doc = d; pages = d.numPages; index = 0; deckName = name || "Slides";
    await render(0);
    prefetch();
    emit("slides_loaded", `${deckName} · ${pages} slide${pages === 1 ? "" : "s"}`);
    return { name: deckName, pages };
  }

  function go(dir) {
    if (!doc) return false;
    const n = clamp(index + dir, 0, pages - 1);
    if (n === index) return false;
    const from = cache.get(index) || null;
    index = n;
    slideFx = { from, dir, start: performance.now() };
    render(index).catch(e => console.warn(e));
    prefetch();
    emit("slide", `${index + 1} of ${pages}`);
    return true;
  }

  function setOn(want, t) {
    if (want === on) return;
    if (want && !doc) { emit("present_no_slides"); return; }
    on = want;
    // Reverse a turn that's in flight from where it is, instead of jumping.
    const p = turn ? clamp((t - turn.start) / TURN_MS) : 1;
    turn = { start: t - (turn ? (1 - p) * TURN_MS : 0), to: want };
    emit(want ? "present_on" : "present_off", want ? `${deckName}, slide ${index + 1}` : "");
  }

  return {
    get loaded() { return !!doc; },
    get on() { return on; },
    get index() { return index; },
    get pages() { return pages; },
    get name() { return deckName; },
    // The picture is un-mirrored while the slide side of the card is showing.
    get unmirrored() { return back; },
    // True while the cut-out is needed (so the segmenter only runs then).
    get needsMask() { return back || on || !!turn; },

    openPdf,
    async openLink(link) {
      const id = slidesIdFrom(link);
      if (!id) throw new Error("That doesn't look like a Google Slides link");
      const data = await fetchSlidesPdf(id);
      return openPdf(data, "Google Slides");
    },
    next() { return go(1); },
    prev() { return go(-1); },
    toggle(t = performance.now()) { setOn(!on, t); },
    set(want, t = performance.now()) { setOn(want, t); },

    setMask(m) {
      if (!m) return;
      maskCanvas = canvas(m.w, m.h, maskCanvas);
      mctx = maskCanvas.getContext("2d");
      const img = mctx.createImageData(m.w, m.h);
      // the cut-out goes into the alpha channel; colour doesn't matter
      for (let i = 0, j = 3; i < m.mask.length; i++, j += 4) img.data[j] = m.mask[i];
      mctx.putImageData(img, 0, 0);
      mask = true; maskSeen = performance.now();
    },

    // Per frame, before anything else: advance the turn. Returns the turn's progress for the HUD.
    update(t) {
      if (turn) {
        const p = clamp((t - turn.start) / TURN_MS);
        back = turn.to ? p >= 0.5 : p < 0.5;
        if (p >= 1) { turn = null; back = on; }
      }
      if (slideFx && t - slideFx.start > SLIDE_MS) slideFx = null;
    },

    // Called after the camera picture is drawn (and graded), before effects draw:
    // replace the room with the slide, keeping you in front.
    compose(ctx, f) {
      if (!back) return;
      const { W, H, t } = f;
      const slide = cache.get(index);
      tmp = canvas(W, H, tmp); tctx = tmp.getContext("2d");
      person = canvas(W, H, person); pctx = person.getContext("2d");

      // 1. you, cut out of the current picture
      pctx.globalCompositeOperation = "source-over";
      pctx.clearRect(0, 0, W, H);
      pctx.drawImage(ctx.canvas, 0, 0);
      const haveMask = mask && t - maskSeen < 1500;
      if (haveMask) {
        pctx.globalCompositeOperation = "destination-in";
        pctx.filter = `blur(${Math.max(1, W / 640)}px)`;   // soft edge
        pctx.drawImage(maskCanvas, 0, 0, W, H);
        pctx.filter = "none";
      }

      // 2. the slide (with the slide-change animation)
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.filter = "none";
      ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, W, H);
      const fit = b => { const s = Math.min(W / b.width, H / b.height); return [(W - b.width * s) / 2, (H - b.height * s) / 2, b.width * s, b.height * s]; };
      if (slideFx && slideFx.from && slide) {
        const k = ease(clamp((t - slideFx.start) / SLIDE_MS)), push = W * 0.06 * slideFx.dir;
        const [ax, ay, aw, ah] = fit(slideFx.from), [bx, by, bw, bh] = fit(slide);
        ctx.globalAlpha = 1; ctx.drawImage(slideFx.from, ax - push * k, ay, aw, ah);
        ctx.globalAlpha = k; ctx.drawImage(slide, bx + push * (1 - k), by, bw, bh);
        ctx.globalAlpha = 1;
      } else if (slide) {
        const [x, y, w, h] = fit(slide); ctx.drawImage(slide, x, y, w, h);
      }
      // 3. you, in front
      if (haveMask) ctx.drawImage(person, 0, 0);
      ctx.restore();
    },

    // Called last, on the finished picture: the card turn.
    post(ctx, f) {
      if (!turn) return;
      const { W, H, t } = f;
      const p = clamp((t - turn.start) / TURN_MS);
      const k = ease(p), a = k * Math.PI;                  // 0 → π
      const sx = Math.abs(Math.cos(a)), lift = Math.sin(a);
      tmp = canvas(W, H, tmp); tctx = tmp.getContext("2d");
      tctx.globalCompositeOperation = "source-over";
      tctx.clearRect(0, 0, W, H); tctx.drawImage(ctx.canvas, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#06080c"; ctx.fillRect(0, 0, W, H);
      const sy = 1 - 0.08 * lift;                          // card lifts away slightly as it turns
      const w = Math.max(1, W * sx), h = H * sy;
      ctx.drawImage(tmp, (W - w) / 2, (H - h) / 2, w, h);
      // light across the card: darker as it turns edge-on, with a moving sheen
      ctx.fillStyle = `rgba(0,0,0,${0.55 * lift})`; ctx.fillRect((W - w) / 2, (H - h) / 2, w, h);
      const gx = (W - w) / 2 + w * (turn.to ? 1 - p : p);
      const g = ctx.createLinearGradient(gx - w * 0.25, 0, gx + w * 0.25, 0);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, `rgba(255,255,255,${0.18 * lift})`); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect((W - w) / 2, (H - h) / 2, w, h);
      ctx.restore();
    },

    // Where a picture point ends up after the card turn (so text follows it).
    mapPoint(p, W, H, t) {
      if (!turn) return { x: p.x, y: p.y, fade: 1 };
      const pr = clamp((t - turn.start) / TURN_MS), a = ease(pr) * Math.PI;
      const sx = Math.abs(Math.cos(a)), sy = 1 - 0.08 * Math.sin(a);
      return { x: W / 2 + (p.x - W / 2) * sx, y: H / 2 + (p.y - H / 2) * sy, fade: sx };
    },
  };
}
