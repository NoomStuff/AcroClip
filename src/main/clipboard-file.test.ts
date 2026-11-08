import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ clipboard: { write: vi.fn() }, ClipboardItem: class {} }));
const { clipboardCommand } = await import("./clipboard-file");

describe("copying a clip file", () => {
   const awkward = "C:\\Clips\\It's $(Get-Date) `x`; rm -r.mp4";
   it("passes the Windows path as data rather than script", () => {
      const command = clipboardCommand(awkward, "win32", { SystemRoot: "C:\\Windows" });
      expect(command?.file).toMatch(/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
      expect(command?.args.join(" ")).not.toContain("Get-Date");
      expect(command?.env["ACROCLIP_CLIPBOARD_FILE"]).toBe(awkward);
   });
   it("passes the macOS path as an AppleScript argument", () => {
      const command = clipboardCommand('/Users/me/It\'s "a" clip.mp4', "darwin", {});
      expect(command?.args.at(-1)).toBe('/Users/me/It\'s "a" clip.mp4');
      expect(command?.args.slice(0, -1).join(" ")).not.toContain("clip.mp4");
   });
   it("uses the clipboard's URI list on Linux", () => {
      expect(clipboardCommand("/home/me/clip.mp4", "linux", {})).toBeNull();
   });
});
