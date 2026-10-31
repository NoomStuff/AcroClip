import { useEffect, useRef } from "react";

export type AppPage = "recording" | "library" | "viewer" | "settings";
export interface NavigationLocation {
   page: AppPage;
   clipId: string | null;
   library: string;
   settings: string;
}
export function reportLocation(page: "library" | "settings", value: string, replace = false): void {
   window.dispatchEvent(new CustomEvent("acroclip-location", { detail: { page, value, replace } }));
}
export function initialLocation(page: "library" | "settings", fallback: string): string {
   const state: unknown = window.history.state;
   return typeof state === "object" && state !== null && page in state && typeof state[page as keyof typeof state] === "string"
      ? String(state[page as keyof typeof state])
      : fallback;
}
export function useNavigationHistory(page: AppPage, clipId: string | null, restore: (location: NavigationLocation) => void): void {
   const location = useRef<NavigationLocation>({ page, clipId, library: "all", settings: "recording" });
   const latest = useRef({ page, clipId, restore });
   latest.current = { page, clipId, restore };
   useEffect(() => {
      window.history.replaceState(location.current, "");
      const publish = (next: NavigationLocation, replace = false) => {
         if (JSON.stringify(next) === JSON.stringify(location.current)) return;
         location.current = next;
         if (replace) window.history.replaceState(next, "");
         else window.history.pushState(next, "");
      };
      const subpage = (event: Event) => {
         const { page: owner, value, replace } = (event as CustomEvent<{ page: "library" | "settings"; value: string; replace?: boolean }>).detail;
         publish({ ...location.current, page: latest.current.page, clipId: latest.current.clipId, [owner]: value }, replace || owner !== latest.current.page);
      };
      const pop = (event: PopStateEvent) => {
         const state = event.state as Partial<NavigationLocation> | null;
         if (
            !state ||
            !["recording", "library", "viewer", "settings"].includes(state.page ?? "") ||
            typeof state.library !== "string" ||
            typeof state.settings !== "string"
         )
            return;
         const next = {
            page: state.page as AppPage,
            clipId: typeof state.clipId === "string" ? state.clipId : null,
            library: state.library,
            settings: state.settings,
         };
         location.current = next;
         latest.current.restore(next);
         window.dispatchEvent(new CustomEvent("acroclip-restore-location", { detail: next }));
      };
      const mouse = (event: MouseEvent) => {
         if (event.button !== 3 && event.button !== 4) return;
         event.preventDefault();
         if (event.type === "mouseup" && !document.querySelector('[aria-modal="true"]')) window.history.go(event.button === 3 ? -1 : 1);
      };
      window.addEventListener("acroclip-location", subpage);
      window.addEventListener("popstate", pop);
      window.addEventListener("mousedown", mouse, true);
      window.addEventListener("mouseup", mouse, true);
      window.addEventListener("auxclick", mouse, true);
      return () => {
         window.removeEventListener("acroclip-location", subpage);
         window.removeEventListener("popstate", pop);
         window.removeEventListener("mousedown", mouse, true);
         window.removeEventListener("mouseup", mouse, true);
         window.removeEventListener("auxclick", mouse, true);
      };
   }, []);
   useEffect(() => {
      const next = { ...location.current, page, clipId };
      if (JSON.stringify(next) === JSON.stringify(location.current)) return;
      const replace = next.page === "viewer" && location.current.page === "viewer" && location.current.clipId === null;
      location.current = next;
      if (replace) window.history.replaceState(next, "");
      else window.history.pushState(next, "");
   }, [page, clipId]);
}
