import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import ts from "typescript";
import { SaveFailure } from "./save-failure";
import { defaultPreferences } from "../shared/defaults";
import { notificationDelivery } from "../shared/notifications";
import { join, resolve } from "node:path";

it("routes main-process notices externally without duplicating renderer toasts", async () => {
   const source = ts.createSourceFile("index.ts", await readFile(new URL("./index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
   const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "notice");
   if (!declaration) throw new Error("Missing notice function");
   const compiled = ts.transpileModule(`(${declaration.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
   const send = vi.fn(),
      showFeedback = vi.fn(async () => undefined);
   const notice = new Script(compiled).runInNewContext({
      send,
      showFeedback,
      log: vi.fn(),
      preferences: { sound: false },
      feedbackUpdates: Promise.resolve(),
   }) as (message: string, error: boolean, kind: string) => void;
   for (const kind of ["saving", "saved", "recording-starting", "recording-progress", "recording-started", "recording-stopped", "critical-error"])
      notice("Status", false, kind);
   await vi.waitFor(() => expect(showFeedback).toHaveBeenCalledTimes(7));
   expect(send).not.toHaveBeenCalled();
});

it("uses the critical cue for failed saves and avoids repeating a reported recorder crash", async () => {
   const source = ts.createSourceFile("index.ts", await readFile(new URL("./index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
   const declaration = source.statements.find(
      (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "captureActionError"
   );
   if (!declaration) throw new Error("Missing capture error handler");
   const compiled = ts.transpileModule(`(${declaration.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
   const criticalFailure = vi.fn(),
      notice = vi.fn(),
      log = vi.fn();
   const recordingNotices = { handledError: () => false, hasReportedError: false };
   const recorder = { status: { state: "recording" } };
   const report = new Script(compiled).runInNewContext({
      criticalFailure,
      notice,
      log,
      SaveFailure,
      recordingNotices,
      recorder,
      errorMessage: (error: Error) => error.message,
   }) as (error: Error) => void;
   report(new SaveFailure("The drive is full"));
   expect(criticalFailure).toHaveBeenCalledExactlyOnceWith("Couldn't save clip", "The drive is full");
   report(new Error("Start recording before saving a clip."));
   expect(notice).toHaveBeenCalledExactlyOnceWith("Start recording before saving a clip.", true);
   recordingNotices.hasReportedError = true;
   recorder.status.state = "error";
   report(new SaveFailure("The helper exited during this action"));
   expect(criticalFailure).toHaveBeenCalledOnce();
   expect(log).toHaveBeenCalledWith("The helper exited during this action");
});

it("routes per-action choices without fullscreen filtering or hiding an unrelated error banner", async () => {
   const source = ts.createSourceFile("index.ts", await readFile(new URL("./index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
   const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "showFeedback");
   if (!declaration) throw new Error("Missing feedback router");
   const settings = source.statements.filter(
      (node): node is ts.VariableStatement =>
         ts.isVariableStatement(node) &&
         node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && ["notificationAction", "feedbackSounds"].includes(item.name.text))
   );
   const compiled = ts.transpileModule(
      `(() => { ${settings.map((item) => item.getText(source)).join("\n")} let visibleNotificationAction = null; ${declaration.getText(source)} return showFeedback; })()`,
      { compilerOptions: { target: ts.ScriptTarget.ES2023 } }
   ).outputText;
   const preferences = {
      ...defaultPreferences,
      notificationStartSound: false,
      notificationSaveBanner: false,
      notificationStopBanner: false,
      notificationStopSound: false,
   };
   const show = vi.fn(),
      foregroundFullscreen = vi.fn();
   const route = new Script(compiled).runInNewContext({
      preferences,
      notificationDelivery,
      feedback: { show },
      recorder: { foregroundFullscreen },
      join,
      resolve,
      isPackagedApp: () => false,
      here: "/app/out/main",
   }) as (message: string, error: boolean, kind: string, details: object) => Promise<void>;
   await route("Error", true, "critical-error", {});
   expect(show.mock.calls.at(-1)?.[3]).toMatchObject({ visual: true });
   await route("Saving", false, "saving", {});
   expect(show.mock.calls.at(-1)?.[3]).toMatchObject({ visual: false, preserveBanner: true });
   expect(show.mock.calls.at(-1)?.[3]).toHaveProperty("sound");
   await route("Stopped", false, "recording-stopped", {});
   expect(show.mock.calls.at(-1)?.[3]).toMatchObject({ visual: false, preserveBanner: true });
   expect(show.mock.calls.at(-1)?.[3]).not.toHaveProperty("sound");
   await route("Starting", false, "recording-starting", {});
   expect(show.mock.calls.at(-1)?.[3]).toMatchObject({ visual: true });
   expect(show.mock.calls.at(-1)?.[3]).not.toHaveProperty("sound");
   preferences.notificationStartBanner = false;
   await route("Starting", false, "recording-progress", {});
   expect(show.mock.calls.at(-1)?.[3]).toMatchObject({ visual: false, preserveBanner: false });
   expect(foregroundFullscreen).not.toHaveBeenCalled();
});
