import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applicationLabel, executableLabel, normalizeApplicationLabel } from "./application-identity";

it("uses the executable rather than the window title and normalizes known legacy captions", () => {
   expect(executableLabel("C:\\Windows\\explorer.exe")).toBe("Explorer");
   expect(normalizeApplicationLabel("Home ─ Explorer")).toBe("Explorer");
   expect(normalizeApplicationLabel("Downloads ─ Explorer")).toBe("Explorer");
   expect(normalizeApplicationLabel("Downloads \u2500 File Explorer")).toBe("Explorer");
   expect(normalizeApplicationLabel("This PC \u2500 File Explorer")).toBe("Explorer");
   expect(normalizeApplicationLabel("Screen 2")).toBe("Desktop");
   expect(normalizeApplicationLabel("Some game - Level 2")).toBe("Some game - Level 2");
});
it("reads a bounded PE resource description and falls back for invalid files", async () => {
   const root = await mkdtemp(join(tmpdir(), "acroclip-app-name-"));
   try {
      const bytes = Buffer.alloc(1024);
      bytes.write("MZ");
      bytes.writeUInt32LE(64, 60);
      bytes.writeUInt32LE(0x4550, 64);
      bytes.writeUInt16LE(1, 70);
      bytes.writeUInt16LE(240, 84);
      bytes.writeUInt16LE(0x20b, 88);
      bytes.writeUInt32LE(0x1000, 216);
      bytes.writeUInt32LE(256, 220);
      bytes.writeUInt32LE(512, 336);
      bytes.writeUInt32LE(0x1000, 340);
      bytes.writeUInt32LE(512, 344);
      bytes.writeUInt32LE(512, 348);
      const key = Buffer.from("FileDescription\0", "utf16le"),
         value = Buffer.from("Stable application\0", "utf16le");
      const start = 528,
         valueAt = Math.ceil((start + 6 + key.length) / 4) * 4;
      bytes.writeUInt16LE(valueAt + value.length - start, start);
      bytes.writeUInt16LE(value.length / 2, start + 2);
      bytes.writeUInt16LE(1, start + 4);
      key.copy(bytes, start + 6);
      value.copy(bytes, valueAt);
      const file = join(root, "unstable-window.exe");
      await writeFile(file, bytes);
      expect(await applicationLabel(file)).toBe("Stable application");
      const corrupt = join(root, "explorer.exe");
      await writeFile(corrupt, "invalid executable");
      expect(await applicationLabel(corrupt)).toBe("Explorer");
   } finally {
      await rm(root, { recursive: true, force: true });
   }
});
