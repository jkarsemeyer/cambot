# CAMBOT Camera (based on Softcam)

This folder is [Softcam](https://github.com/tshino/softcam) (MIT licence, see LICENSE), commit 8f545e2,
with these changes so it installs as CAMBOT's own camera:

- Device name: "CAMBOT Camera" (was "DirectShow Softcam").
- Its own ID (CLSID), in `GUID.txt`, so it never clashes with other apps that use Softcam.
- Its own shared-memory and mutex names.
- Release builds use the static C runtime, so the DLL loads inside any call app without extra installs.

Built automatically by `.github/workflows/build.yml`. Only `softcam.vcxproj` (and the two projects it references) is built.
