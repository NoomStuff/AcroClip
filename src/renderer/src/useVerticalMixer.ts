import { useSyncExternalStore } from "react";

const storageKey = "acroclip.layout.recording.verticalMixer";
const listeners = new Set<() => void>();
let vertical = (() => {
   try {
      return localStorage.getItem(storageKey) === "true";
   } catch {
      return false;
   }
})();

export function setVerticalMixer(next: boolean): void {
   vertical = next;
   try {
      localStorage.setItem(storageKey, String(next));
   } catch {
      /* The choice still applies until the app restarts. */
   }
   listeners.forEach((listener) => listener());
}

/** Whether the audio mixer shows channels as side by side strips with upright faders. */
export function useVerticalMixer(): boolean {
   return useSyncExternalStore(
      (listener) => {
         listeners.add(listener);
         return () => listeners.delete(listener);
      },
      () => vertical
   );
}
