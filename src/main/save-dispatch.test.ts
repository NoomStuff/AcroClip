import { afterEach, expect, it, vi } from "vitest";
import { Script } from "node:vm";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { SaveFailure } from "./save-failure";
import { StorageMonitor } from "./storage";
import { recordingDestination, recordingSourceLabel } from "./safety";
import { withinRoot } from "./collection";
import { defaultPreferences } from "../shared/defaults";
import { bufferedCaptureSource } from "../shared/capture-policy";
import { recordingArtwork } from "./recording-artwork";
import { normalizeApplicationLabel } from "./application-identity";

afterEach(() => vi.useRealTimers());
it.each([
   { pendingMove: false, failSave: false },
   { pendingMove: true, failSave: false },
   { pendingMove: false, failSave: true },
   { pendingMove: true, failSave: true },
])("dispatches saves without waiting for space reads, pending move $pendingMove, rejected save $failSave", async ({ pendingMove, failSave }) => {
   const root = await mkdtemp(join(tmpdir(), "acroclip-save-dispatch-"));
   const content = await readFile(join(import.meta.dirname, "index.ts"), "utf8");
   const parsed = ts.createSourceFile("index.ts", content, ts.ScriptTarget.Latest, true);
   const functionNode = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "saveClip");
   if (!functionNode) throw new Error("The main save action was not found");
   // Execute the actual function, not a rewritten copy. Only its external recorder
   // and filesystem-query boundaries are controlled. This proves dispatch order,
   // not successful recording or ENOSPC handling.
   const read = vi.fn(() => new Promise<bigint>(() => undefined));
   const storage = new StorageMonitor({ readSpace: read, onChange: () => undefined, onWarning: () => undefined });
   storage.setActivity(root, false);
   const save = vi.fn<(path: string, requestedAt: number) => Promise<void>>(async () => {
      if (failSave) throw new Error("Clip write failed");
   });
   let finishMove = () => {};
   const fileChanges = pendingMove
      ? new Promise<void>((resolve) => {
           finishMove = resolve;
        })
      : Promise.resolve();
   try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-11T06:00:00Z"));
      const saveClip = new Script(`(${functionNode.getText(parsed)})`).runInNewContext({
         Date,
         SaveFailure,
         errorMessage: (error: Error) => error.message,
         closingRequested: false,
         recorder: { status: { state: "recording" }, pendingSavePaths: [], save },
         storage,
         collections: { root, finishFileChanges: () => fileChanges },
         preferences: { ...defaultPreferences, collection: root },
         captureSources: { cached: [] },
         lastRecordingArtwork: undefined,
         send: () => undefined,
         notice: () => undefined,
         recordingDestination,
         recordingSourceLabel,
         bufferedCaptureSource,
         recordingArtwork,
         normalizeApplicationLabel,
         randomUUID,
         mkdirSync,
         dirname,
         realpathSync,
         withinRoot,
      }) as () => Promise<void>;
      let returned = false;
      let rejected: unknown;
      void saveClip().then(
         () => {
            returned = true;
         },
         (error: unknown) => {
            rejected = error;
         }
      );
      await vi.advanceTimersByTimeAsync(0);
      if (pendingMove) {
         expect(save).not.toHaveBeenCalled();
         vi.setSystemTime(new Date("2026-10-11T06:00:02Z"));
         finishMove();
         await vi.advanceTimersByTimeAsync(0);
      }
      expect(read).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(1);
      expect(returned).toBe(!failSave);
      if (failSave) {
         expect(rejected).toBeInstanceOf(SaveFailure);
         expect(rejected).toMatchObject({ message: "Clip write failed" });
      }
      expect(save.mock.calls[0]?.[1]).toBe(new Date("2026-10-11T06:00:00Z").getTime());
      expect(withinRoot(root, save.mock.calls[0]?.[0] ?? "")).toBe(true);
   } finally {
      storage.close();
      await vi.advanceTimersByTimeAsync(3000);
      vi.useRealTimers();
      await rm(root, { force: true, recursive: true });
   }
});
