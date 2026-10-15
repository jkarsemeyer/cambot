# CAMBOT

Gesture-triggered webcam effects for video calls. CAMBOT appears in Zoom, Teams and Meet as its own camera, **CAMBOT Camera**, so no OBS is needed.

## Install

1. Open the repo's **Releases** page and download the newest `CAMBOT-Setup-x.y.z.exe`.
2. Run it.
   - Windows may say "Windows protected your PC", because the installer isn't code-signed. Click **More info**, then **Run anyway**.
   - Approve the administrator prompt. It installs CAMBOT Camera.
3. CAMBOT opens and starts by itself.

To get your voice into calls, install [VB-Cable](https://vb-audio.com/Cable/) once (free), then restart CAMBOT. It picks VB-Cable automatically.

## Use it on a call

1. Keep CAMBOT running. It can be behind other windows or minimised.
2. In the call app, set **Camera** to **CAMBOT Camera**.
3. Set **Microphone** to **CABLE Output (VB-Audio Virtual Cable)**.

## Effects

| Key | Effect | How |
| --- | --- | --- |
| 1 | Storm Caller | Raise both hands, make fists, hold. Lightning strikes, then your eyes glow and your voice drops. Raise open palms to power down. |
| 2 | Fire Palm | Show an open palm to catch fire. Make a fist to put it out. Both palms burning lights your eyes and voice. |

Other keys:
- **Space:** test the current effect
- **P:** reset it
- **H:** clean view
- **F:** fullscreen
- **D:** show tracking points

## Testing your voice

In the panel under **Voice**:
- **Record 5 seconds**, then compare **Play original** with **Play with effect**.
- Under **Hear it on this computer**, tick **My voice, live** to hear yourself in real time. Use headphones for this.
- **Keep the voice effect on** holds the effect on while you adjust Pitch and Electric.

## Making effects

See [docs/making-effects.md](docs/making-effects.md).
