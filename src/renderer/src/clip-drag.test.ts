import { expect, it } from "vitest";
import { readCollectionDrag } from "./clip-drag";

it("accepts a single clip only from the current collection", () => {
   expect(readCollectionDrag(JSON.stringify({ id: "clip", collection: "Videos" }), "Videos")).toBe("clip");
   expect(readCollectionDrag(JSON.stringify({ id: "clip", collection: "Elsewhere" }), "Videos")).toBeNull();
   for (const value of ["", "{", "null", "[]", JSON.stringify({ id: ["one", "two"], collection: "Videos" }), JSON.stringify({ id: "", collection: "Videos" })])
      expect(readCollectionDrag(value, "Videos")).toBeNull();
});
