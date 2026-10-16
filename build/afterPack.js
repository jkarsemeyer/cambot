// Mac builds: give the app an ad-hoc signature. Apple Silicon Macs refuse to run code with no
// signature at all. This isn't an Apple Developer ID signature, so the first launch still needs
// approving in System Settings (see README).
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const appPath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
};
