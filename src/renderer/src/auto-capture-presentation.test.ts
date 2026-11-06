import { expect, it } from "vitest";
import { stoppedRecorder } from "../../shared/defaults";
import type { GameCandidate } from "../../shared/types";
import { autoCapturePresentation } from "./auto-capture-presentation";

const game: GameCandidate = { id: "window:1:0", pid: 1, name: "Game window", gameName: "Game", executable: "game.exe", foreground: true, fullscreen: false };

it("hides the previous application until the new Auto scan completes", () => {
   const recorder = {
      ...stoppedRecorder,
      supported: true,
      state: "waiting" as const,
      sourceKind: "app" as const,
      sourceId: "window:1:99",
      sourceName: "Previous application",
   };
   const pending = autoCapturePresentation([game], recorder, false);
   expect(pending).toMatchObject({ label: "Auto capture", title: "Finding games", finding: true, previewApplication: false });
   expect(pending.game).toBeUndefined();
   expect(pending.name).toBeUndefined();
   const empty = autoCapturePresentation([], recorder, true);
   expect(empty).toMatchObject({ label: "Auto capture", title: "No game detected", previewApplication: false });
});

it("does not mistake buffered footage or an unrecognized application for an Auto target", () => {
   const application = { ...game };
   delete application.gameName;
   const display = autoCapturePresentation(
      [application],
      {
         ...stoppedRecorder,
         supported: true,
         state: "waiting",
         sourceKind: "app",
         sourceId: game.id,
         sourceName: "Old application",
         bufferedSourceName: "Old game",
         bufferedSourceId: game.id,
         bufferedSourceKind: "app",
      },
      true
   );
   expect(display.name).toBeUndefined();
   expect(display.previewApplication).toBe(false);
   expect(display.label).toBe("Auto capture");
});

it("distinguishes a detected game, a waiting target, and confirmed game capture", () => {
   expect(autoCapturePresentation([game], stoppedRecorder, true)).toMatchObject({ label: "Detected game", title: "Game", previewApplication: false });
   const recorder = {
      ...stoppedRecorder,
      supported: true,
      state: "waiting" as const,
      sourceKind: "app" as const,
      sourceId: "window:1:99",
      sourceName: "Game window",
   };
   expect(autoCapturePresentation([game], recorder, true)).toMatchObject({ label: "Waiting for game", title: "Game", previewApplication: true });
   expect(autoCapturePresentation([game], { ...recorder, state: "recording" }, true)).toMatchObject({
      label: "Capturing game",
      title: "Game window",
      previewApplication: true,
   });
   expect(autoCapturePresentation([game], { ...recorder, state: "recording", sourceId: "window:other:0" }, true)).toMatchObject({
      label: "Detected game",
      title: "Game",
      previewApplication: false,
   });
});
