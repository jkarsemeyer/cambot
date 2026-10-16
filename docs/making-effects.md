# Making a new effect

Every effect is one file in `app/src/effects/`. The engine handles the camera, tracking, sound outputs,
the virtual camera and the panel. An effect only decides what gestures do and what they look and sound like.

## Steps

1. Copy `app/src/effects/fire-palm.js` to a new file, for example `ice-touch.js`.
2. Change `id`, `name` and `blurb` at the top.
3. Add it to the list in `app/src/effects/index.js`. Its position there is its number key.
4. Push to GitHub. A new installer appears under Releases in about 10 minutes.

To try changes without building an installer, run `npm run web` and open `http://localhost:8787/app/` in Chrome.
Everything except CAMBOT Camera works there.

## The shape of an effect

```js
export default {
  id: "ice-touch",                 // unique, lowercase, used to save settings
  name: "Ice Touch",               // shown in the picker
  blurb: "One sentence for the panel.",
  voice: { pitch: 1.1, electric: 0.2, mix: 0.6 },   // the voice when fully transformed (pitch 1 = unchanged, mix 1 = all effect)
  settings: [                      // become sliders and menus in Effect settings, saved automatically
    { key: "holdMs", label: "Hold", type: "range", min: 200, max: 2000, step: 50, default: 600, format: v => `${v} ms` },
    { key: "color", label: "Colour", type: "select", options: [["ice", "Ice"], ["glass", "Glass"]], default: "ice" },
  ],
  idleSteps: ["idle"],             // optional: steps where a gesture shortcut may switch to another mode (default: the first step)
  steps: [                         // the sequence shown in the panel
    { id: "idle", label: "Touch your fingertips" },
    { id: "frozen", label: "Frozen" },
  ],
  create(kit) {
    // set up state here, then return the live effect:
    return {
      step: "idle",                // which of `steps` is active (a getter works well)
      progress: 0,                 // 0..1, fills the bar under the coach text
      coach: "Touch your fingertips",
      voice: 0,                    // 0 = normal voice, 1 = fully transformed
      update(f) {},                // every frame: read gestures, change state
      grade(f) { return {}; },     // optional colour grade for the camera picture
      draw(ctx, f) {},             // draw the effect; this is what calls see
      overlay(ctx, f) {},          // guides only you see (hidden in clean view and on calls)
      get backdropAmount() { return 0; },  // optional, 0..1: replace the room behind you (you stay in front)
      backdrop(ctx, f) {},         // paints that background over the whole frame (uses the person cut-out)
      labels(f) { return []; },    // optional text: [{ text, sub, x, y, size, alpha, color, glow }]. Never draw
                                   // text in draw(): calls get the picture un-mirrored, so it would read backwards.
      trigger(f) {},               // Space / Test effect: fire it without gestures
      reset(f) {},                 // P: back to the start
      dispose() {},                // stop any sound loops
    };
  },
};
```

## What each frame gives you (`f`)

| Field | Meaning |
| --- | --- |
| `f.t`, `f.dt` | Time now in milliseconds, and seconds since the last frame |
| `f.W`, `f.H` | Picture size in pixels |
| `f.hands` | Up to 2 hands, sorted left to right on screen |
| `f.face` | The face, or `null` |

Each hand has:
- `palm` (centre point) and `size` (a good unit for scaling effects to the hand)
- `fist`, `open` and `pinch` (true or false)
- `point`, `L` (thumb and index out), `peace`, `thumbsUp`, `upright` (open, fingers up), and `tip` (index fingertip)
- `ext` and `curl`: per finger [index, middle, ring, pinky], extended or curled, plus `thumb` (thumb out)
- `x01`, `y01`: palm position as a fraction of the frame
- `P`: all 21 points. 0 is the wrist, and 4, 8, 12, 16 and 20 are the fingertips from thumb to pinky.

The face has:
- `eyes`: each eye's centre `c`, size `r` and how open it is (`open`, 0 to 1)
- `roll`: head tilt
- `mouthOpen`: 0 to 1
- `P`: all 478 points

## The kit (`kit`)

| Tool | Use |
| --- | --- |
| `kit.settings` | This effect's current setting values, e.g. `kit.settings.holdMs` |
| `kit.emit(name, detail)` | Announce an event; it shows in the event log |
| `kit.on(name, fn)` | Listen for an event; cleaned up automatically when switching effects |
| `kit.sfx.play(name, ...)` | One-shot sounds: `thunder`, `zap`, `whoosh`, `hiss`, `powerDown`, `blip` |
| `kit.sfx.loop(kind)` | Continuous sounds `hum`, `drone`, `fire`. Returns `{ set(0..1), stop() }` |
| `new kit.Holds()` | "Has this been true for N ms?" timers: `holds.held("fist", hand.fist, 500, f.t)` |

Drawing helpers come from `app/src/draw.js`:
- `glowDot`: a soft glow
- `makeBolt` and `strokeBolt`: lightning
- `Particles`: sparks, embers and smoke
- `drawEyes`: glowing eyes
- `vignette`: darkened edges

## Gesture shortcuts

`app/src/shortcuts.js` handles gestures that work in every mode: switching modes and the layered effects
(zoom, mirror, confetti, glitch). They're applied to the finished picture after your effect draws.
While a shortcut gesture is being held, your effect keeps seeing the hands from just before it started,
so the shortcut doesn't also trigger your effect's own gestures. Avoid using those shapes as your effect's triggers.

## Tips

- Draw light with `ctx.globalCompositeOperation = "lighter"` so glows add up like real light.
- Size everything from `hand.size` or `face.faceH`, so effects scale with distance from the camera.
- Give every gesture a hold time, or detection flicker will make the effect fire repeatedly.
- New sounds go in `app/src/audio.js`, as a method on `Output` for one-shots or a new `kind` in `loop()`.
