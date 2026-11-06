import { beforeEach, describe, expect, it } from "vitest";
import { clearAll, closeOpen, dismiss, expire, getSnapshot, notify, resetNotifications, setCondition, splitMessage, toggleOpen } from "./notifications";

const entries = () => getSnapshot().entries;

describe("notifications", () => {
   beforeEach(() => resetNotifications());

   it("splits the first sentence into a title and keeps the rest as detail", () => {
      expect(splitMessage("Save shortcut is unavailable. Choose another in Settings.")).toEqual({
         title: "Save shortcut is unavailable",
         detail: "Choose another in Settings.",
      });
      expect(splitMessage("Clip saved")).toEqual({ title: "Clip saved", detail: "" });
      expect(splitMessage("Saving clip…")).toEqual({ title: "Saving clip…", detail: "" });
      expect(splitMessage("Could not move round.mp4 to the folder.")).toEqual({ title: "Could not move round.mp4 to the folder", detail: "" });
   });

   it("removes plain notifications when their toast ends and keeps chipped ones as chips", () => {
      notify({ message: "Clip saved" });
      notify({ message: "Export failed", tone: "error", chip: true });
      const [failure, saved] = entries();
      expire(saved!.id);
      expire(failure!.id);
      expect(entries().map((entry) => [entry.title, entry.phase])).toEqual([["Export failed", "chip"]]);
   });

   it("moves a repeated message to the front instead of stacking it", () => {
      notify({ message: "Export failed", tone: "error", chip: true });
      notify({ message: "Clip saved" });
      notify({ message: "Export failed", tone: "error", chip: true });
      expect(entries().map((entry) => entry.title)).toEqual(["Export failed", "Clip saved"]);
   });

   it("lets a condition replace a notification saying the same thing and leave once cleared", () => {
      notify({ message: "Storage is low", tone: "warning", chip: true });
      setCondition("storage", { message: "Storage is low", tone: "warning" });
      expect(entries()).toHaveLength(1);
      expect(entries()[0]!.key).toBe("storage");
      notify({ message: "Storage is low", tone: "warning", chip: true });
      expect(entries()).toHaveLength(1);
      setCondition("storage", null);
      expect(entries()).toHaveLength(0);
   });

   it("updates a condition in place and keeps a dismissed one away until its message changes", () => {
      setCondition("audio", { message: "Audio capture is reconnecting" });
      const id = entries()[0]!.id;
      setCondition("audio", { message: "Audio device was removed" });
      expect(entries()[0]).toMatchObject({ id, title: "Audio device was removed" });
      dismiss(id);
      setCondition("audio", { message: "Audio device was removed" });
      expect(entries()).toHaveLength(0);
      setCondition("audio", { message: "Audio capture is reconnecting" });
      expect(entries()).toHaveLength(1);
   });

   it("toggles a chip open and closed, and forgets it once dismissed", () => {
      notify({ message: "Export failed", tone: "error", chip: true });
      const id = entries()[0]!.id;
      toggleOpen(id);
      expect(getSnapshot().open).toBe(id);
      toggleOpen(id);
      expect(getSnapshot().open).toBeNull();
      toggleOpen(id);
      closeOpen();
      expect(getSnapshot().open).toBeNull();
      toggleOpen(id);
      dismiss(id);
      expect(getSnapshot().open).toBeNull();
   });

   it("clears chips but leaves toasts that are still counting down", () => {
      notify({ message: "Export failed", tone: "error", chip: true });
      const id = entries()[0]!.id;
      expire(id);
      notify({ message: "Rename failed", tone: "error", chip: true });
      clearAll();
      expect(entries().map((entry) => entry.title)).toEqual(["Rename failed"]);
   });
});
