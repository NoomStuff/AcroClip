import { normalizeApplicationLabel } from "../../shared/application-label";
import type { GameCandidate } from "../../shared/types";

/** An app by its executable, so every window of it is the same pick. */
export const applicationKey = (app: Pick<GameCandidate, "executable" | "id">): string => (app.executable || app.id).replaceAll("\\", "/").toLowerCase();

// Windows runs Store apps inside this host, so picking it captures the host instead of the app.
const hosts = new Set(["applicationframehost.exe"]);

/** One entry per app a picker can offer, in the order given. */
export function applicationChoices(candidates: readonly GameCandidate[]): GameCandidate[] {
   const seen = new Set<string>();
   return candidates.filter((app) => {
      const key = applicationKey(app);
      if (seen.has(key) || hosts.has(key.split("/").at(-1)!)) return false;
      seen.add(key);
      return true;
   });
}

/** The app's short name, which follows it across windows. Its window title changes as you use it. */
export function applicationChoiceName(app: GameCandidate): string {
   return app.applicationName ?? app.gameName ?? normalizeApplicationLabel(app.name);
}
