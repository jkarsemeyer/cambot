// Present: your slides become the background, with you cut out in front of them.
//
// Slides come from a Google Slides link (downloaded as a PDF by the desktop app) or a PDF you open.
// Entering and leaving is a card turn: the picture turns over like a card, and the back has you in
// front of your slides. Calls normally get the mirrored view you see, so slides read correctly
// everywhere. If calls are set to the true camera view, the picture stops being mirrored halfway
// through the turn instead, so slides still read correctly, and the turn hides the switch.

import { clamp } from "./util.js";
import { cutout } from "./cutout.js";

const TURN_MS = 900, SLIDE_MS = 420;
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");   // the "legacy" build: works on older browser engines too
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.mjs", document.baseURI).href;
  return pdfjs;
}

// The deck id from any Google Slides link: .../presentation/d/<id>/edit...
export function slidesIdFrom(link) {
  const m = String(link || "").match(/\/presentation\/(?:u\/\d+\/)?d\/(?:e\/)?([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}

export function createPresenter({ emit, fetchSlidesPdf, wantUnmirror = () => false }) {
  let doc = null, deckName = "", pages = 0;
  const cache = new Map();                 // page number → ImageBitmap
  let index = 0;
  let on = false;                          // presenting (target state)
  let turn = null;                         // { from, to, start } while the card turns
  let back = false;                        // showing the back of the card (slides behind you)
  let slideFx = null;                      // { from: bitmap, dir, start } while changing slides
  let tmp = null, tctx = null, cam = null;

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
    if (doc) { for (const b of cache.values()) b.close(); cache.clear(); try { (doc.destroy || doc.loadingTask?.destroy)?.call(doc.destroy ? doc : doc.loadingTask); } catch {} }
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
    get unmirrored() { return back && wantUnmirror(); },
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
    compose(ctx, f, mirrored) {
      if (!back) return;
      const { W, H, t } = f;
      const slide = cache.get(index);
      const fit = b => { const s = Math.min(W / b.width, H / b.height); return [(W - b.width * s) / 2, (H - b.height * s) / 2, b.width * s, b.height * s]; };
      const paint = c => {
        c.fillStyle = "#0b0d12"; c.fillRect(0, 0, W, H);
        if (slideFx && slideFx.from && slide) {
          const k = ease(clamp((t - slideFx.start) / SLIDE_MS)), push = W * 0.06 * slideFx.dir;
          const [ax, ay, aw, ah] = fit(slideFx.from), [bx, by, bw, bh] = fit(slide);
          c.globalAlpha = 1; c.drawImage(slideFx.from, ax - push * k, ay, aw, ah);
          c.globalAlpha = k; c.drawImage(slide, bx + push * (1 - k), by, bw, bh);
          c.globalAlpha = 1;
        } else if (slide) {
          const [x, y, w, h] = fit(slide); c.drawImage(slide, x, y, w, h);
        }
      };
      // you in front of the slide; if the cut-out isn't running yet, the slide with you in a corner box
      if (cutout.replaceBackground(ctx, f, 1, paint, mirrored)) return;
      cam = canvas(W, H, cam); const cc = cam.getContext("2d");
      cc.clearRect(0, 0, W, H); cc.drawImage(ctx.canvas, 0, 0);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = "none"; ctx.globalCompositeOperation = "source-over";
      paint(ctx);
      const bw = W * 0.28, bh = H * 0.28, bx = W - bw - W * 0.025, by = H - bh - H * 0.04;
      ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
      ctx.drawImage(cam, bx, by, bw, bh);
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
