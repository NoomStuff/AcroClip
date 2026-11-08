import { expect, it } from "vitest";
import { selectAudioTracks } from "./audio-tracks";

const tracks = [{ index: 1 }, { index: 2 }, { index: 4 }];

it("enables exactly the selected tracks, enabling before disabling", () => {
   const changes: string[] = [];
   const list = [true, false, false].map((initial, ordinal) => {
      let enabled = initial;
      return {
         get enabled() {
            return enabled;
         },
         set enabled(value: boolean) {
            changes.push(`${ordinal}:${value}`);
            enabled = value;
         },
      };
   });
   expect(selectAudioTracks(list, tracks, [2, 4])).toBe(true);
   expect(list.map((item) => item.enabled)).toEqual([false, true, true]);
   expect(changes).toEqual(["1:true", "2:true", "0:false"]);
});

it("reports tracks that don't line up with the clip", () => {
   expect(selectAudioTracks(undefined, tracks, [1])).toBe(false);
   expect(selectAudioTracks([{ enabled: true }], tracks, [1])).toBe(false);
   expect(selectAudioTracks([], [], [])).toBe(true);
});
