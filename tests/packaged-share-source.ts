import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, type Page } from "@playwright/test";
import type { Clip } from "../src/shared/types";

/** Small capture fixtures correctly cannot use the minimum 1 MB share target. */
export async function packagedShareSource(page: Page, ffmpeg: string, recording: Clip): Promise<Clip> {
   if (recording.size >= 1_000_000) return recording;
   const rejected = await page.evaluate(async (id) => {
      try {
         await window.acroClip.createShareable(id, 1);
         return false;
      } catch (error) {
         return String(error).includes("size target no larger than the clip");
      }
   }, recording.id);
   expect(rejected).toBe(true);
   const source = join(dirname(recording.path), "Packaged sharing fixture.mp4");
   await promisify(execFile)(
      ffmpeg,
      [
         "-v",
         "error",
         "-f",
         "lavfi",
         "-i",
         "testsrc2=size=960x540:rate=30",
         "-f",
         "lavfi",
         "-i",
         "sine=frequency=997:sample_rate=48000",
         "-t",
         "6",
         "-c:v",
         "libx264",
         "-threads",
         "1",
         "-preset",
         "ultrafast",
         "-crf",
         "18",
         "-c:a",
         "aac",
         source,
      ],
      { windowsHide: true }
   );
   await page.evaluate(() => window.acroClip.refresh());
   await expect
      .poll(() => page.evaluate(async (file) => (await window.acroClip.state()).clips.find((clip) => clip.path === file)?.size ?? 0, source))
      .toBeGreaterThanOrEqual(1_000_000);
   return page.evaluate(async (file) => (await window.acroClip.state()).clips.find((clip) => clip.path === file)!, source);
}
