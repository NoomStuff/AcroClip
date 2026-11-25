import { describe, expect, it } from "vitest";
import { shortcutRegistry } from "../../shared/shortcuts";
import { searchSettings, settingGroups } from "./settings-catalog";

const found = (query: string) => searchSettings(query).flatMap(({ group, items }) => items.map((id) => `${group.id}/${id}`));

describe("settings catalog", () => {
   it("gives every setting exactly one home, including the ones Essentials repeats", () => {
      const homes = settingGroups.filter((group) => group.home).flatMap((group) => group.items);
      expect(new Set(homes).size).toBe(homes.length);
      for (const group of settingGroups.filter((item) => !item.home)) for (const id of group.items) if (id !== "qualityPreset") expect(homes).toContain(id);
   });

   it("lists every shortcut once", () => {
      const shortcuts = settingGroups
         .filter((group) => group.home)
         .flatMap((group) => group.items)
         .filter((id) => id.startsWith("shortcut:"));
      expect(shortcuts.toSorted()).toEqual(shortcutRegistry.map((item) => `shortcut:${item.id}`).toSorted());
   });
});

describe("searchSettings", () => {
   it("finds settings by the words people use, not only their labels", () => {
      expect(found("mic")).toEqual(["recording-sources/sources"]);
      expect(found("frame rate")).toEqual(["recording-quality/quality"]);
      expect(found("hotkey clip")).toContain("clips-clip/clip");
      expect(found("directory")).toEqual(["clips-saving/folder"]);
   });

   it("matches word starts so results narrow while typing", () => {
      expect(found("sea")).toEqual(["shortcuts-library/shortcut:search", "shortcuts-settings/shortcut:searchSettings"]);
      expect(found("seek")).toEqual(["shortcuts-player/shortcut:seekBack", "shortcuts-player/shortcut:seekForward"]);
   });

   it("puts setting names ahead of choices, and choices ahead of descriptions", () => {
      const compress = searchSettings("compress");
      expect(compress.map(({ group, strength }) => [group.id, strength])).toEqual([
         ["recording-quality", 3],
         ["clips-shareables", 1],
      ]);
      expect(searchSettings("normally")).toMatchObject([{ group: { id: "clips-clip" }, items: ["overlap"], strength: 2 }]);
   });

   it("ranks a setting by its weakest word", () => {
      expect(searchSettings("save normally")).toMatchObject([{ group: { id: "clips-clip" }, items: ["overlap"], strength: 2 }]);
   });

   it("never lists the repeats in Essentials", () => {
      expect(searchSettings("quality").every(({ group }) => group.home)).toBe(true);
   });

   it("returns nothing for an empty or unknown query", () => {
      expect(searchSettings("   ")).toEqual([]);
      expect(searchSettings("zzz")).toEqual([]);
   });
});
