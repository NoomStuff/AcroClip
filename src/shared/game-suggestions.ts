import type { CustomGame, GameCandidate } from "./types";

// Where store launchers install games. The folder right after the marker is the game's own.
const libraries: ReadonlyArray<{ store: string; marker: RegExp }> = [
   { store: "Steam", marker: /\/steamapps\/common\/([^/]+)\//i },
   { store: "Epic Games", marker: /\/epic games\/([^/]+)\//i },
   { store: "GOG", marker: /\/gog galaxy\/games\/([^/]+)\//i },
   { store: "Xbox", marker: /\/xboxgames\/([^/]+)\//i },
   { store: "EA", marker: /\/ea games\/([^/]+)\//i },
   { store: "Ubisoft", marker: /\/ubisoft game launcher\/games\/([^/]+)\//i },
];
// Store folders also hold tools that aren't games.
const tools = /(crash|report|launcher|setup|unins|redist|anticheat|helper|updater|vcredist|dxsetup|steamworks shared|steamvr)/i;

/** The store a running app was installed from and the game's folder name, if it sits in a store's game library. */
export function storeGame(executable: string): { store: string; name: string } | undefined {
   const path = executable.replaceAll("\\", "/");
   if (tools.test(path.split("/").at(-1) ?? "")) return undefined;
   for (const { store, marker } of libraries) {
      const folder = marker.exec(path)?.[1];
      if (folder && !tools.test(folder)) return { store, name: folder };
   }
   return undefined;
}

/**
 * Running apps that look like games the catalog doesn't know: installed in a store's game library,
 * unrecognized, and not added already. They're only offered. Store folders hold tools too, so
 * AcroClip never captures these automatically.
 */
export function gameSuggestions(
   candidates: readonly GameCandidate[],
   added: readonly CustomGame[]
): Array<GameCandidate & { store: string; suggestedName: string }> {
   const key = (value: string) => value.replaceAll("\\", "/").toLowerCase();
   const known = new Set(added.map((game) => key(game.executable)));
   const seen = new Set<string>();
   return candidates.flatMap((candidate) => {
      const store = storeGame(candidate.executable);
      if (!store || candidate.gameName || known.has(key(candidate.executable)) || seen.has(key(candidate.executable))) return [];
      seen.add(key(candidate.executable));
      return [{ ...candidate, store: store.store, suggestedName: store.name }];
   });
}
