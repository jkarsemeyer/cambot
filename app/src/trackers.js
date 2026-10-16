// Hand and face tracking (Google MediaPipe). The engine and models ship in app/vendor and app/models.
// Each tracker runs in its own worker (tracking-worker.js), so the two run side by side on separate
// processor cores and never hold up drawing. The page sends a small copy of each camera frame and
// keeps drawing with the latest result it has.

import { withTimeout } from "./util.js";

const here = path => new URL(path, document.baseURI).href;
const VISION_WASM = here("vendor/tasks-vision/wasm");
const MODELS = { hands: here("models/hand_landmarker.task"), face: here("models/face_landmarker.task"), segment: here("models/selfie_segmenter_landscape.tflite") };
// Frame width each tracker gets. The person cut-out model works at 256×144, so it gets a small copy.
const INPUT_W = { hands: 640, face: 640, segment: 320 };

// Tracking input size. The models work at about 200 px internally, so 640×360 loses no accuracy
// but makes each frame much cheaper to hand over than the full camera picture.
export const TRACK_W = 640, TRACK_H = 360;

function startWorker(kind, preferGpu, onStage) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./tracking-worker.js", import.meta.url), { type: "module", name: `${kind} tracking` });
    let busy = false, onResult = null;
    const tracker = {
      kind, inputW: INPUT_W[kind],
      get busy() { return busy; },
      // Takes ownership of the bitmap. Returns false (and closes it) if a frame is already in flight.
      send(bitmap, ts) {
        if (busy) { bitmap.close(); return false; }
        busy = true;
        worker.postMessage({ type: "frame", bitmap, ts }, [bitmap]);
        return true;
      },
      onResult(fn) { onResult = fn; },
      close() { worker.terminate(); },
    };
    worker.onerror = e => reject(new Error(e.message || "Tracking worker failed to start"));
    worker.onmessage = ({ data }) => {
      switch (data.type) {
        case "loaded":
          onStage && onStage(`starting on ${preferGpu ? "graphics card" : "processor"}…`);
          worker.postMessage({ type: "init", kind, wasm: VISION_WASM, model: MODELS[kind], preferGpu });
          break;
        case "ready": resolve({ tracker, where: data.where }); break;
        case "error": worker.terminate(); reject(new Error(data.message)); break;
        case "warn": console.warn(`${kind} tracking:`, data.message); break;
        case "result":
          busy = false;
          if (onResult) onResult(data.landmarks, data.ts);
          break;
      }
    };
  });
}

// Backup: the same tracker on the page itself (the old way). Slower, since it holds up drawing
// while it works, but it keeps tracking alive if a worker can't start on some machine.
async function startInPage(kind, preferGpu, onStage) {
  const { FilesetResolver, HandLandmarker, FaceLandmarker } = await import("../vendor/tasks-vision/vision_bundle.mjs");
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM);
  const Task = kind === "hands" ? HandLandmarker : FaceLandmarker;
  const extra = kind === "hands"
    ? { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }
    : { numFaces: 1 };
  let task = null, where = "", lastErr;
  for (const delegate of preferGpu ? ["GPU", "CPU"] : ["CPU", "GPU"]) {
    try {
      onStage && onStage(`starting on ${delegate === "GPU" ? "graphics card" : "processor"} (backup mode)…`);
      task = await Task.createFromOptions(vision, { baseOptions: { modelAssetPath: MODELS[kind], delegate }, runningMode: "VIDEO", ...extra });
      where = delegate === "GPU" ? "graphics card" : "processor";
      break;
    } catch (e) { lastErr = e; }
  }
  if (!task) throw lastErr;
  let onResult = null;
  const tracker = {
    kind, busy: false,
    send(bitmap, ts) {
      let lm = null;
      try { const r = task.detectForVideo(bitmap, ts); lm = kind === "hands" ? r.landmarks : r.faceLandmarks; }
      catch (e) { console.warn(e); }
      finally { bitmap.close(); }
      if (onResult) onResult(lm, ts);
      return true;
    },
    onResult(fn) { onResult = fn; },
    close() { task.close(); },
  };
  return { tracker, where: `${where}, backup mode` };
}

async function start(kind, preferGpu, onStage) {
  try {
    return await withTimeout(startWorker(kind, preferGpu, onStage), 60000, `Starting ${kind} tracking`);
  } catch (e) {
    console.warn(`${kind} tracking worker failed, using backup mode`, e);
    return withTimeout(startInPage(kind, preferGpu, onStage), 60000, `Starting ${kind} tracking`);
  }
}

export const createHandTracker = (preferGpu, onStage) => start("hands", preferGpu, onStage);
export const createFaceTracker = (preferGpu, onStage) => start("face", preferGpu, onStage);
// Person cut-out for presenting. Worker only: the in-page backup would be too slow to be worth it.
export const createSegmenter = (preferGpu, onStage) => withTimeout(startWorker("segment", preferGpu, onStage), 60000, "Starting the person cut-out");
