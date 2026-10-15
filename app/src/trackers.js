// Hand and face tracking (Google MediaPipe). The engine and models ship in app/vendor and app/models.

import { FilesetResolver, HandLandmarker, FaceLandmarker } from "../vendor/tasks-vision/vision_bundle.mjs";
import { withTimeout } from "./util.js";

const here = path => new URL(path, document.baseURI).href;
const VISION_WASM = here("vendor/tasks-vision/wasm");
const HAND_MODEL = here("models/hand_landmarker.task");
const FACE_MODEL = here("models/face_landmarker.task");

let vision = null;

// Processor first (reliable everywhere); graphics card first only when the user turns it on.
async function create(Task, options, preferGpu, onStage) {
  vision ||= await withTimeout(FilesetResolver.forVisionTasks(VISION_WASM), 15000, "Loading the tracking engine");
  const order = preferGpu ? ["GPU", "CPU"] : ["CPU", "GPU"];
  let lastErr;
  for (const delegate of order) {
    const where = delegate === "GPU" ? "graphics card" : "processor";
    onStage && onStage(`starting on ${where}…`);
    try {
      const tracker = await withTimeout(
        Task.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate } }),
        delegate === "GPU" ? 20000 : 45000, `Starting on the ${where}`);
      return { tracker, where };
    } catch (e) {
      lastErr = e;
      onStage && onStage(`${where} failed, trying another way…`);
    }
  }
  throw lastErr;
}

export function createHandTracker(preferGpu, onStage) {
  return create(HandLandmarker, {
    baseOptions: { modelAssetPath: HAND_MODEL },
    runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  }, preferGpu, onStage);
}

export function createFaceTracker(preferGpu, onStage) {
  return create(FaceLandmarker, {
    baseOptions: { modelAssetPath: FACE_MODEL },
    runningMode: "VIDEO", numFaces: 1,
  }, preferGpu, onStage);
}
