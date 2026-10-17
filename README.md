# CAMBOT

Gesture-triggered webcam effects for video calls. CAMBOT appears in Zoom, Teams and Meet as its own camera, **CAMBOT Camera**, so no OBS is needed.

## Install

1. Download the newest `CAMBOT-Setup-x.y.z.exe` from [cambot-releases](https://github.com/jkarsemeyer/cambot-releases/releases/latest).
2. Run it.
   - Windows may say "Windows protected your PC", because the installer isn't code-signed. Click **More info**, then **Run anyway**.
   - Approve the administrator prompt. It installs CAMBOT Camera.
3. CAMBOT opens and starts by itself.

To get your voice into calls, install [VB-Cable](https://vb-audio.com/Cable/) once (free), then restart CAMBOT. It picks VB-Cable automatically.

## Present slides

Put your slides behind you, with you cut out in front of them.

1. Under **Present slides** in the panel, paste a Google Slides link and click **Load link**. The deck must be
   shared as *Anyone with the link → Viewer*. For any other deck: in Slides, **File → Download → PDF**, then
   **Open PDF…** (or drop the PDF onto CAMBOT).
2. Start: **part your hands like curtains** (both open hands together, then sweep them apart), click
   **Present**, or press **S**. The picture turns over like a card and you're in front of your first slide.
3. Next / previous: **swipe one open hand** towards your left for next, towards your right for previous.
   A presentation clicker works too, even while the call app is in front. So do the arrow keys in CAMBOT.
4. Stop: **close the curtains** (sweep your hands back together), or press **S** again.

Effects keep working on top of your slides. The link is remembered; next time, Present loads it for you.

## What calls see

By default calls get exactly what's on your CAMBOT screen: the mirrored view. That keeps drawings next to your
hand and names over your stars, all reading the right way. (Real text behind you, like a poster, appears
reversed to others.) Untick **Send what I see (mirrored)** under *Send to calls* for the true camera view.
Note: Meet mirrors your *own* preview, so in Meet's little self-view things look backwards. Everyone else sees
them correctly. Trust the CAMBOT window.

## Mac

1. From [cambot-releases](https://github.com/jkarsemeyer/cambot-releases/releases/latest), download
   `CAMBOT-x.y.z-mac-arm64.dmg` for Apple Silicon (M1 and later) or `-mac-x64.dmg` for Intel Macs.
   Not sure? Apple menu → About This Mac: "Chip: Apple M…" means arm64.
2. Open the .dmg and drag CAMBOT into Applications.
3. First launch: open CAMBOT. macOS says it can't check it for malicious software. Click **Done**, then go to
   **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to CAMBOT.
   (The app isn't signed with an Apple Developer ID, so macOS asks this once per new version.)
4. Allow camera and microphone access when asked.
5. For your voice in calls, install [BlackHole 2ch](https://existential.audio/blackhole/) (free) and restart
   CAMBOT. In the call app, set **Microphone** to **BlackHole 2ch**.

**Not on Mac yet: CAMBOT Camera.** macOS only loads virtual cameras signed with a paid Apple Developer account,
so the Mac app can't appear as a camera in call apps yet. Everything else works.
**Updates on Mac:** CAMBOT tells you when a new version is out and opens the download page. macOS only lets
signed apps update themselves.

## Use it on a call

1. Keep CAMBOT running. It can be behind other windows or minimised.
2. In the call app, set **Camera** to **CAMBOT Camera**.
3. Set **Microphone** to **CABLE Output (VB-Audio Virtual Cable)**.

## Effects

| Key | Effect | How |
| --- | --- | --- |
| 1 | Storm Caller | Raise both hands, make fists, hold. Lightning strikes, then your eyes glow and your voice drops. Raise open palms to power down. |
| 2 | Fire Palm | Show an open palm to catch fire. Make a fist to put it out. Both palms burning lights your eyes and voice. |
| 3 | Star Map | Pinch to place a star (keep pinching to drag it; pinch a star to move it). Point at a star and sweep to others to link them. Lower your finger to finish: 3 or more linked stars get a silly name (The Chork, Deez, Yo Mama…), subtitled "An Array of Stars". Each constellation fades the room behind you further into a night sky (full night after 4, adjustable). Two fists clear the sky. |
| 4 | Air Draw | Pinch your thumb and finger to draw; release to lift the pen. Hold still at the end of a stroke to straighten a line or round a circle. Pinch a colour in the palette at the top of your screen (only you see it), or CLR to clear. A held fist erases what it moves over; two fists clear. Calls get the same mirrored view you see, so drawings line up with your hand and read correctly. Backspace undoes. |

### Gesture shortcuts (work in every mode)

| Gesture | Does |
| --- | --- |
| Point at an open hand | Switch to Storm Caller |
| Point at a fist | Switch to Fire Palm |
| Point at a pinch (thumb and index touching) | Switch to Star Map |
| Both hands make an L, framing a rectangle | Zoom in on your face. Again to zoom out |
| Both open hands upright, side by side | Mirror at the middle of your face. Again for the other side, again for off |
| Thumbs up | Confetti |
| Peace sign | Glitch burst |
| Part both open hands like curtains | Start presenting (once slides are loaded). Close them to stop; swipe one hand to change slides |

Hold each gesture for a moment. A ring fills up around your hands while you hold. Mode switching only works
while the current effect is at rest. Turn shortcuts off under **Gesture shortcuts** in the panel.

Other keys:
- **Space:** test the current effect
- **P:** reset it
- **H:** clean view
- **F:** fullscreen
- **D:** show tracking points
- **S:** present slides on/off; **← →** or **Page Up / Page Down** change slides
- **Z, M, C, G:** zoom, mirror, confetti, glitch (to test without gestures)

## Testing your voice

In the panel under **Voice**:
- **Record 5 seconds**, then compare **Play original** with **Play with effect**.
- Under **Hear it on this computer**, tick **My voice, live** to hear yourself in real time. Use headphones for this.
- **Effect mix** blends the effect with your natural voice. Lower it if words are hard to make out. It's saved per effect.
- **Keep the voice effect on** holds the effect on while you adjust Pitch, Electric and Effect mix.

## Updates

CAMBOT checks for a new version when it starts and every 2 hours, and downloads it in the background.
When it's ready, a bar at the top of the panel offers **Restart to update** (approve the Windows prompt).
If you don't restart, it installs the next time you close CAMBOT.

## Making effects

See [docs/making-effects.md](docs/making-effects.md).
