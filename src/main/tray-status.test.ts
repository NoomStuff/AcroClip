import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Script } from "node:vm";
import ts from "typescript";
import { stoppedRecorder } from "../shared/defaults";
import type { RecorderState } from "../shared/types";

const content = await readFile(join(import.meta.dirname, "index.ts"), "utf8");
const parsed = ts.createSourceFile("index.ts", content, ts.ScriptTarget.Latest, true);
const functionNode = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "updateTray");
if (!functionNode) throw new Error("The tray update function was not found");
const functionText = functionNode.getText(parsed);
function update(status: RecorderState) {
   const tooltip = vi.fn();
   const updateTray = new Script(`(${functionText})`).runInNewContext({
      tray: { setToolTip: tooltip, setContextMenu: () => undefined },
      recorder: { status },
      startingCapture: null,
      Menu: { buildFromTemplate: (items: unknown[]) => items },
   }) as () => void;
   updateTray();
   return tooltip.mock.calls[0]?.[0] as string;
}
describe("actual tray status", () => {
   it("uses the waiting reason and a neutral fallback for unknown reasons", () => {
      expect(update({ ...stoppedRecorder, state: "waiting", message: "Microphone: selected device is unavailable" })).toBe(
         "AcroClip · Microphone: selected device is unavailable"
      );
      expect(update({ ...stoppedRecorder, state: "waiting", message: "" })).toBe("AcroClip · Waiting for capture");
   });
   it("keeps persistent failure visible and ordinary idle/capture wording intact", () => {
      expect(update({ ...stoppedRecorder, state: "error", message: "Recording stopped unexpectedly with exit code 17" })).toBe(
         "AcroClip · Recording stopped unexpectedly with exit code 17"
      );
      expect(update({ ...stoppedRecorder, state: "recording" })).toBe("AcroClip · Recording");
      expect(update(stoppedRecorder)).toBe("AcroClip");
   });
});
