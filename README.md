# CAMBOT

Gesture-triggered webcam effects for video calls. CAMBOT appears in Zoom, Teams and Meet as its own camera, **CAMBOT Camera**, so no OBS is needed.

## Install

1. Download the newest `CAMBOT-Setup-x.y.z.exe` from [cambot-releases](https://github.com/jkarsemeyer/cambot-releases/releases/latest).
2. Run it.
   - Windows may say "Windows protected your PC", because the installer isn't code-signed. Click **More info**, then **Run anyway**.
   - Approve the administrator prompt. It installs CAMBOT Camera.
3. CAMBOT opens and starts by itself.

To get your voice into calls, install [VB-Cable](https://vb-audio.com/Cable/) once (free), then restart CAMBOT. It picks VB-Cable automatically.

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
| 3 | Star Map | Pinch to place a star (keep pinching to drag it; pinch a star to move it). Point at a star and sweep to others to link them. Lower your finger to finish: 3 or more linked stars get a made-up name, subtitled "An Array of Stars". Each constellation fades the room behind you further into a night sky (full night after 4, adjustable). Two fists clear the sky. |

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

Hold each gesture for a moment. A ring fills up around your hands while you hold. Mode switching only works
while the current effect is at rest. Turn shortcuts off under **Gesture shortcuts** in the panel.

Other keys:
- **Space:** test the current effect
- **P:** reset it
- **H:** clean view
- **F:** fullscreen
- **D:** show tracking points
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
