# Folder structure

```
cambot/
├── app/                        The app itself (runs in the desktop app or in Chrome)
│   ├── index.html              Layout and styling of the screen and panel
│   ├── pitch-worklet.js        Voice pitch shifter (runs on the audio thread)
│   ├── src/
│   │   ├── main.js             Start-up, frame loop, effect switching, panel
│   │   ├── effects/            One file per effect. index.js lists them
│   │   ├── gestures.js         Tracking points → fist / open / pinch / eyes / mouth
│   │   ├── trackers.js         Starts hand and face tracking, each in its own worker
│   │   ├── tracking-worker.js  Runs one tracker off the main thread
│   │   ├── audio.js            Sounds, voice effect, the two outputs, voice test
│   │   ├── draw.js             Glows, lightning, particles, glowing eyes
│   │   ├── vcam.js             Sends the picture to CAMBOT Camera
│   │   ├── config.js           Saved settings
│   │   ├── bus.js              Named events
│   │   └── util.js             Small helpers
│   ├── vendor/tasks-vision/    Google MediaPipe 0.10.14 (bundled, unmodified)
│   └── models/                 Hand and face tracking models
├── electron/
│   ├── main.js                 Desktop window, permissions, camera install/status
│   └── preload.js              Connects the page to the CAMBOT Camera DLL
├── native/softcam/             Virtual webcam source (Softcam, renamed CAMBOT Camera)
├── build/
│   ├── icon.png                App icon
│   └── installer.nsh           Registers CAMBOT Camera during install
├── docs/making-effects.md      How to write a new effect
├── tools/serve.py              Preview the app in Chrome: npm run web
├── .github/workflows/build.yml Builds the Windows installer on every push
├── PROJECT_NOTES.md            Decisions and known limits
└── package.json                Dependencies and installer settings
```
