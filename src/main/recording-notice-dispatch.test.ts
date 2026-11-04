import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import ts from "typescript";
import { defaultPreferences } from "../shared/defaults";
import { recordingSourceLabel } from "./safety";

it.each(["startRecording", "toggleRecording"])("acknowledges the %s bind before pending preference writes or capture setup", async (action) => {
   const content = await readFile(new URL("./index.ts", import.meta.url), "utf8");
   const source = ts.createSourceFile("index.ts", content, ts.ScriptTarget.Latest, true);
   const declaration = (name: string): string => {
      const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name);
      if (!node) throw new Error(`Missing ${name}`);
      return node.getText(source);
   };
   let releasePreferences = () => {};
   const pendingPreferences = new Promise<void>((resolve) => {
      releasePreferences = resolve;
   });
   let finishCaptureStart = () => {};
   const captureStarted = new Promise<void>((resolve) => {
      finishCaptureStart = resolve;
   });
   const acknowledge = vi.fn();
   const capture = vi.fn(async () => {
      finishCaptureStart();
   });
   const sourceList = vi.fn(async () => []);
   const failure = vi.fn();
   // Run the actual bind handler and start action. This checks dispatch order,
   // not successful native capture, which requires the isolated desktop suite.
   const compiled = ts.transpileModule(`(() => { ${declaration("startRecording")} ${declaration("globalAction")} return globalAction; })()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2023 },
   }).outputText;
   const trigger = new Script(compiled).runInNewContext({
      preferences: { ...defaultPreferences, setupComplete: true, sourceKind: "screen" },
      closingRequested: false,
      startingCapture: null,
      lastRecordingArtwork: undefined,
      recorder: { status: { state: "stopped" }, start: capture },
      recordingNotices: { starting: acknowledge, startFailed: failure },
      preferenceWrites: pendingPreferences,
      ensureMicrophoneAccess: async () => undefined,
      captureSources: { cached: [], list: sourceList },
      recordingSourceLabel,
      emitState: () => undefined,
      updateTray: () => undefined,
      captureActionError: failure,
   }) as (action: string) => void;
   trigger(action);
   expect(acknowledge).toHaveBeenCalledExactlyOnceWith("Screen");
   expect(sourceList).not.toHaveBeenCalled();
   expect(capture).not.toHaveBeenCalled();
   releasePreferences();
   await captureStarted;
   expect(sourceList).toHaveBeenCalledOnce();
   expect(capture).toHaveBeenCalledOnce();
   expect(failure).not.toHaveBeenCalled();
});
