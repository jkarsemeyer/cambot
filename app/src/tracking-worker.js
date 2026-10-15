// Runs one tracker (hands or face) off the main thread, so tracking never stalls the picture.
// The page sends small frames as ImageBitmaps; this sends back the raw landmarks.

// The tracking engine loads its WebAssembly glue with importScripts(), which module workers
// don't allow. Load it with a synchronous fetch and run it in global scope instead.
self.importScripts = (...urls) => {
  for (const url of urls) {
    const x = new XMLHttpRequest();
    x.open("GET", String(url), false);
    x.send();
    if (x.status && x.status >= 400) throw new Error(`Couldn't load ${url} (${x.status})`);
    (0, eval)(x.responseText);
  }
};

const { FilesetResolver, HandLandmarker, FaceLandmarker } = await import("../vendor/tasks-vision/vision_bundle.mjs");

let tracker = null, kind = null;

async function create({ kind: k, wasm, model, preferGpu }) {
  kind = k;
  const vision = await FilesetResolver.forVisionTasks(wasm);
  const Task = kind === "hands" ? HandLandmarker : FaceLandmarker;
  const extra = kind === "hands"
    ? { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }
    : { numFaces: 1 };
  let lastErr;
  for (const delegate of preferGpu ? ["GPU", "CPU"] : ["CPU", "GPU"]) {
    try {
      tracker = await Task.createFromOptions(vision, { baseOptions: { modelAssetPath: model, delegate }, runningMode: "VIDEO", ...extra });
      return delegate === "GPU" ? "graphics card" : "processor";
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try { self.postMessage({ type: "ready", where: await create(data) }); }
    catch (e) { self.postMessage({ type: "error", message: e && e.message ? e.message : String(e) }); }
    return;
  }
  if (data.type === "frame") {
    const { bitmap, ts } = data;
    let landmarks = null;
    try {
      const r = tracker.detectForVideo(bitmap, ts);
      // Only send the points: the rest of the result object can't cross to the page cheaply.
      landmarks = kind === "hands" ? r.landmarks : r.faceLandmarks;
    } catch (e) {
      self.postMessage({ type: "warn", message: e && e.message ? e.message : String(e) });
    } finally {
      bitmap.close();
    }
    self.postMessage({ type: "result", landmarks, ts });
  }
};

self.postMessage({ type: "loaded" });
