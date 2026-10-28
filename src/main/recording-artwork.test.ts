import { expect, it } from "vitest";
import { recordingArtwork } from "./recording-artwork";
import type { CaptureSource } from "../shared/types";

const footage = { kind: "app" as const, id: "window:42:0", name: "Game" };
const source: CaptureSource = { id: footage.id, name: footage.name, kind: "app", thumbnail: "", applicationId: "game", appIcon: "icon" };

it("retains application metadata when the same recorded window disappears from enumeration", () => {
   const known = recordingArtwork(footage, [source]);
   expect(known?.application.id).toBe("game");
   expect(recordingArtwork(footage, [], known)).toEqual(known);
});

it("does not carry application metadata into another window or a screen recording", () => {
   const known = recordingArtwork(footage, [source]);
   expect(recordingArtwork({ ...footage, id: "window:43:0" }, [], known)).toBeUndefined();
   expect(recordingArtwork({ ...footage, kind: "screen" }, [], known)).toBeUndefined();
});

it("refreshes application metadata when an enumerated window identity changes", () => {
   const known = recordingArtwork(footage, [source]);
   expect(recordingArtwork(footage, [{ ...source, applicationId: "new-game", appIcon: "new-icon" }], known)?.application).toEqual({
      id: "new-game",
      icon: "new-icon",
   });
});
