import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function mediaTool(name: "ffmpeg" | "ffprobe"): string {
   const bundled = resolve(`resources/media/${name}${process.platform === "win32" ? ".exe" : ""}`);
   return existsSync(bundled) ? bundled : (process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"] ?? name);
}
