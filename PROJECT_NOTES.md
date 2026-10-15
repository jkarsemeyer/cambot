# Project notes

## Decisions

- **Windows only for now.** A Mac virtual camera needs Apple's Camera Extension, which requires a paid developer account and signing.
- **Electron desktop app.** Effects stay in web tech (canvas, Web Audio, MediaPipe), so new effects are quick to write and can be previewed in Chrome.
- **Virtual camera: Softcam (MIT)**, renamed "CAMBOT Camera" with its own ID. It's registered by the installer, which shows one administrator prompt. It works on Windows 10 and 11 in apps that list DirectShow cameras (Zoom, Teams, Chrome and Edge for Meet). The app calls the DLL through koffi, so there's no custom native addon to compile.
- **Voice into calls: VB-Cable.** Windows doesn't let an app act as a microphone without an audio driver. CAMBOT selects VB-Cable automatically the first time it's found.
- **Two sound outputs.** "Hear it on this computer" and "Send to calls" each run their own copy of the voice effect and sounds, so each can use any device with no extra delay.
- **Tracking runs on the processor by default.** The graphics-card mode hung on one test machine. It's an opt-in setting.
- **Everything is bundled** (tracking engine, models). CAMBOT never downloads anything at runtime.
- **Builds:** GitHub Actions on Windows (`.github/workflows/build.yml`). Every push to `main` publishes a new installer as release `v0.2.<build number>`.

## Known limits

- The installer is unsigned, so Windows SmartScreen warns on first run.
- Only one copy of CAMBOT can send to CAMBOT Camera at a time.
- Some Microsoft Store apps, and the Windows Camera app, only list Media Foundation cameras and won't see CAMBOT Camera. Zoom, Teams and browsers do.

## Ideas for later

- Describe effects as data (gesture → action lists) instead of code.
- Per-effect sound packs and imported images or sprites.
- Recording clips directly from CAMBOT.
