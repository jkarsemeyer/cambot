# Project notes

## Decisions

- **Windows only for now.** A Mac virtual camera needs Apple's Camera Extension, which requires a paid developer account and signing.
- **Electron desktop app.** Effects stay in web tech (canvas, Web Audio, MediaPipe), so new effects are quick to write and can be previewed in Chrome.
- **Virtual camera: Softcam (MIT)**, renamed "CAMBOT Camera" with its own ID. It's registered by the installer, which shows one administrator prompt. It works on Windows 10 and 11 in apps that list DirectShow cameras (Zoom, Teams, Chrome and Edge for Meet). The app calls the DLL through koffi, so there's no custom native addon to compile.
- **Voice into calls: VB-Cable.** Windows doesn't let an app act as a microphone without an audio driver. CAMBOT selects VB-Cable automatically the first time it's found.
- **Two sound outputs.** "Hear it on this computer" and "Send to calls" each run their own copy of the voice effect and sounds, so each can use any device with no extra delay.
- **Tracking runs in workers, off the main thread.** Hands and face each get a worker, fed a 640-wide copy of each camera frame; drawing never waits and uses the latest result. If a worker can't start, tracking falls back to running on the page (slower). The fps chip shows drawing rate and each tracker's update rate.
- **CAMBOT Camera reads frames back asynchronously** (VideoFrame.copyTo), so sending to calls doesn't stall drawing. Falls back to the blocking read if unavailable.
- **Tracking runs on the processor by default.** The graphics-card mode hung on one test machine. It's an opt-in setting.
- **Everything is bundled** (tracking engine, models). CAMBOT never downloads anything at runtime.
- **Builds:** GitHub Actions on Windows (`.github/workflows/build.yml`). Every push to `main` publishes a new installer as release `v0.2.<build number>`.
- **Auto-update: electron-updater, reading the public repo `jkarsemeyer/cambot-releases`.** The code repo stays private; only installers, `latest.yml` and blockmaps go public, because an app can't read private releases without shipping a token. The build publishes there using the `RELEASES_TOKEN` secret (fine-grained token, Contents read/write on cambot-releases only). Updates download in the background and install on "Restart to update" or on quit.
- **Voice wet/dry mix.** An equal-power blend of natural and processed voice, saved per effect (default 60% effect) so the voice stays understandable.

- **Gesture shortcuts sit above the modes** (`shortcuts.js`): point at an open hand or fist to switch mode (only while the mode is at rest), plus layers that work in any mode (finger-frame zoom, mirror, confetti, glitch). Layers post-process the finished picture so effects stay aligned. Every shortcut needs a short hold and must be released before it can fire again.

- **Audio levels:** the effect voice is level-matched to your normal voice (within about 1.5 dB) and each output ends in a safety limiter, so voice plus thunder or fire never clips. Measured offline with a synthetic voice through the real chain. The build checks every app file parses, after a syntax error once silently switched the voice to the backup processor.

## Known limits

- The installer is unsigned, so Windows SmartScreen warns on first run.
- Only one copy of CAMBOT can send to CAMBOT Camera at a time.
- Some Microsoft Store apps, and the Windows Camera app, only list Media Foundation cameras and won't see CAMBOT Camera. Zoom, Teams and browsers do.

## Ideas for later

- Describe effects as data (gesture → action lists) instead of code.
- Per-effect sound packs and imported images or sprites.
- Recording clips directly from CAMBOT.
