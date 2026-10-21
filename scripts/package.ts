import { spawnSync } from "node:child_process";
import { provisionMedia } from "./provision-media";

// Local packaging stages the same media and recorder as CI. Publication is a
// separate operation over verified artifacts, never an electron-builder mode.
const mode = process.argv[2];
if (mode !== "dist" && mode !== "dir") throw new Error("Pass dist or dir.");
const extra = process.argv.slice(3);
const target = process.platform === "win32" ? "--win" : process.platform === "darwin" ? "--mac" : "--linux";
const allowed = new Set([
   target,
   `--${process.arch}`,
   ...(process.platform === "win32" ? ["nsis", "portable"] : process.platform === "darwin" ? ["dmg", "zip"] : ["AppImage"]),
]);
if (extra.some((argument) => !allowed.has(argument))) throw new Error("Local packaging accepts only targets for the current host and architecture.");
const media = process.env["FFMPEG_PATH"] && process.env["FFPROBE_PATH"] ? {} : await provisionMedia();
const env = { ...process.env, ...media, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
function run(command: string, args: string[]): void {
   const result = spawnSync(command, args, { stdio: "inherit", env, windowsHide: true });
   if (result.error) throw result.error;
   if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}
for (const script of ["bundle:media", "build:native", "build:icons", "build:notices", "build"]) run("bun", ["run", script]);
run("bunx", ["--no-install", "electron-builder", ...(mode === "dir" ? ["--dir"] : []), ...extra, "--publish", "never"]);
