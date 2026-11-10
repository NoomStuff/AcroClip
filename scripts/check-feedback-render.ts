import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

// File-only native drawing. --render-proof creates no window and plays no sound.
// Windows draws with GDI+, Linux with the GTK helper's Cairo code. macOS has no helper.
if (process.platform !== "win32" && process.platform !== "linux") throw new Error("The thumbnail regression check needs the Windows or Linux helper.");
const helper = resolve(process.argv[2] ?? (process.platform === "win32" ? "resources/recorder/acroclip-notifier.exe" : "native/notifications/linux.py"));
const directory = await mkdtemp(join(tmpdir(), "acroclip-feedback-render-"));
const frames = [1, 1.25, 1.5, 2].flatMap((scale) =>
   [0, 25, 55, 100, 170, 250, 340].map((age) => ({ scale, age, path: join(directory, `${scale}-${age}.png`) }))
);
try {
   const marker = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 240, g: 30, b: 40, alpha: 1 } } })
      .png()
      .toBuffer();
   const calibration = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 20, g: 180, b: 190, alpha: 1 } } })
      .composite([{ input: marker, left: 96, top: 96 }])
      .png()
      .toBuffer();
   const result = spawnSync(helper, ["--render-proof"], {
      windowsHide: true,
      encoding: "utf8",
      input:
         frames
            .map((frame) =>
               JSON.stringify({
                  message: "Clip saved",
                  detail: "Replay.mp4",
                  completed: true,
                  elapsedMs: 1000,
                  completionAgeMs: frame.age,
                  scale: frame.scale,
                  proofPath: frame.path,
                  artwork: `data:image/png;base64,${calibration.toString("base64")}`,
               })
            )
            .join("\n") + "\n",
   });
   if (result.error) throw result.error;
   assert.equal(result.status, 0, result.stderr);
   for (const frame of frames) {
      const { data, info } = await sharp(frame.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let left = info.width,
         right = -1,
         top = info.height,
         bottom = -1;
      for (let y = 0; y < info.height; y++)
         for (let x = 0; x < info.width; x++) {
            const offset = (y * info.width + x) * 4;
            if (data[offset]! > 180 && data[offset + 1]! < 120 && data[offset + 2]! < 130 && data[offset + 3]! > 200) {
               left = Math.min(left, x);
               right = Math.max(right, x);
               top = Math.min(top, y);
               bottom = Math.max(bottom, y);
            }
         }
      assert(right >= left && bottom >= top, "The native drawing lost the calibration marker.");
      const center = 64 * frame.scale - 0.5;
      assert.equal((left + right) / 2, center, `Horizontal drift at ${frame.age} ms, scale ${frame.scale}`);
      assert.equal((top + bottom) / 2, center, `Vertical drift at ${frame.age} ms, scale ${frame.scale}`);
   }
   console.log(`Native thumbnail center stayed fixed in ${frames.length} frames across 100%, 125%, 150% and 200% display scaling.`);
} finally {
   await Promise.all(frames.map((frame) => rm(frame.path, { force: true })));
   await rmdir(directory);
}
