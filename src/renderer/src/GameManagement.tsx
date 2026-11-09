import { MotionList } from "./MotionList";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, Plus, Search, Trash2 } from "lucide-react";
import type { RefObject } from "react";
import type { CaptureSource, CustomGame, GameCandidate, GameCatalogSnapshot, Preferences } from "../../shared/types";
import { api, describeError } from "./desktop";
import { Button, IconButton, Select } from "./ui";
import { DialogPanel } from "./Dialog";
import { ApplicationIcon } from "./ApplicationIcon";
// The catalogue is large and rarely changes, so the Games page keeps it between visits instead of loading it every time.
let cachedCatalog: GameCatalogSnapshot | null = null;
const sameCatalog = (a: GameCatalogSnapshot, b: GameCatalogSnapshot) =>
   a.source === b.source && a.entries.length === b.entries.length && a.entries.every((entry, index) => entry.id === b.entries[index]?.id);
const executableKey = (value: string) => value.replaceAll("\\", "/").toLowerCase();
const withAddedGame = (games: CustomGame[], game: CustomGame): CustomGame[] => [
   ...games.filter((item) => executableKey(item.executable) !== executableKey(game.executable)),
   game,
];
function AddGameDialog({ additions, add, close }: { additions: CustomGame[]; add: (game: CustomGame) => void | Promise<void>; close: () => void }) {
   const [candidates, setCandidates] = useState<GameCandidate[]>([]),
      [sources, setSources] = useState<CaptureSource[]>([]);
   const [selected, setSelected] = useState(""),
      [name, setName] = useState(""),
      [loading, setLoading] = useState(true),
      [saving, setSaving] = useState(false),
      [error, setError] = useState("");
   const load = useCallback(async () => {
      setLoading(true);
      setError("");
      try {
         const [games, sources] = await Promise.all([api.games(), api.sources().catch(() => [])]);
         setCandidates(games);
         setSelected(games[0]?.id ?? "");
         setName((games[0]?.gameName || games[0]?.name || "").slice(0, 200));
         setSources(sources);
      } catch (reason) {
         setError(describeError(reason));
      } finally {
         setLoading(false);
      }
   }, []);
   useEffect(() => {
      void load();
   }, [load]);
   const game = candidates.find((item) => item.id === selected);
   const full = additions.length >= 500 && !additions.some((item) => executableKey(item.executable) === executableKey(game?.executable ?? ""));
   const submit = async () => {
      if (!game || !name.trim() || full) return;
      setSaving(true);
      setError("");
      try {
         await add({ name: name.trim(), executable: game.executable });
         close();
      } catch (reason) {
         setError(describeError(reason));
      } finally {
         setSaving(false);
      }
   };
   return (
      <DialogPanel title="Add game" close={close}>
         <form
            className="game-add-form"
            onSubmit={(event) => {
               event.preventDefault();
               void submit();
            }}
         >
            <p>Choose a running application to recognize as a game.</p>
            <Select
               label="Running application"
               value={selected}
               disabled={loading || saving}
               onChange={(id) => {
                  setSelected(id);
                  const next = candidates.find((item) => item.id === id);
                  setName((next?.gameName || next?.name || "").slice(0, 200));
               }}
            >
               {!selected && (
                  <option value="" disabled>
                     {loading ? "Finding applications…" : "No applications available"}
                  </option>
               )}
               {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                     {item.name}
                  </option>
               ))}
            </Select>
            {!loading && !candidates.length && <p>Open the application, then try again.</p>}
            {game && (
               <div className="game-add-identity">
                  <ApplicationIcon size={24} src={sources.find((source) => source.id.split(":")[1] === game.id.split(":")[1])?.appIcon} />
                  <span data-tooltip={game.executable} data-tooltip-overflow="">
                     {game.executable}
                  </span>
               </div>
            )}
            <label className="game-name">
               Game name
               <input aria-label="Game name" maxLength={200} value={name} disabled={!game || saving} onChange={(event) => setName(event.target.value)} />
            </label>
            {(error || full) && (
               <p className="game-error" role="alert">
                  {error || "You can add up to 500 applications."}
               </p>
            )}
            <div className="dialog-actions">
               <Button type="button" className="quiet" disabled={loading || saving} onClick={() => void load()}>
                  Try again
               </Button>
               <Button type="button" onClick={close}>
                  Cancel
               </Button>
               <Button type="submit" className="primary" busy={saving} disabled={!game || !name.trim() || full}>
                  Add selected game
               </Button>
            </div>
         </form>
      </DialogPanel>
   );
}
export function GameManagement({
   preferences,
   change,
   searchRef,
}: {
   preferences: Preferences;
   change: (games: CustomGame[]) => void;
   searchRef: RefObject<HTMLInputElement | null>;
}) {
   const [catalog, setCatalog] = useState<GameCatalogSnapshot | null>(cachedCatalog),
      [error, setError] = useState(""),
      [query, setQuery] = useState(""),
      [limit, setLimit] = useState(80),
      [adding, setAdding] = useState(false);
   useEffect(() => {
      let disposed = false;
      void api
         .gameCatalog()
         .then((value) => {
            // A refreshed catalogue replaces the cached one, but an unchanged one keeps the list as it is.
            if (cachedCatalog && sameCatalog(cachedCatalog, value)) return;
            cachedCatalog = value;
            if (!disposed) setCatalog(value);
         })
         .catch((reason: unknown) => {
            if (!disposed && !cachedCatalog) setError(describeError(reason));
         });
      return () => {
         disposed = true;
      };
   }, []);
   const entries = useMemo(() => {
      const known = catalog?.entries ?? [],
         index = new Map<string, Array<{ id: string; suffix: string }>>();
      for (const game of known)
         for (const exe of game.executables) {
            const suffix = executableKey(exe),
               base = suffix.split("/").at(-1)!;
            const bucket = index.get(base) ?? [];
            bucket.push({ id: game.id, suffix });
            index.set(base, bucket);
         }
      const overridden = new Set<string>();
      const added = preferences.customGames.map((game) => {
         const exe = executableKey(game.executable),
            matches = new Set(
               (index.get(exe.split("/").at(-1)!) ?? []).filter((item) => exe === item.suffix || exe.endsWith("/" + item.suffix)).map((item) => item.id)
            );
         if (matches.size === 1) overridden.add([...matches][0]!);
         return { id: "added:" + exe, name: game.name, executables: [game.executable], added: true };
      });
      return [...known.filter((game) => !overridden.has(game.id)).map((game) => ({ ...game, added: false })), ...added].sort(
         (a, b) => Number(b.added) - Number(a.added) || a.name.localeCompare(b.name)
      );
   }, [catalog, preferences.customGames]);
   const filtered = useMemo(() => {
      const value = query.trim().toLowerCase();
      return entries.filter((game) => !value || game.name.toLowerCase().includes(value) || game.executables.some((exe) => exe.toLowerCase().includes(value)));
   }, [entries, query]);
   const sentinel = useRef<HTMLDivElement>(null);
   const visibleEntries = filtered.slice(0, limit);
   useEffect(() => {
      const node = sentinel.current;
      if (!node || limit >= filtered.length) return;
      const observer = new IntersectionObserver(
         ([entry]) => {
            if (entry?.isIntersecting) setLimit((current) => current + 80);
         },
         { root: node.closest(".settings-scroll"), rootMargin: "400px" }
      );
      observer.observe(node);
      return () => observer.disconnect();
   }, [limit, filtered.length]);
   const renderGame = (game: (typeof entries)[number]) => (
      <div className="game-entry" role="listitem">
         <Gamepad2 size={20} />
         <div>
            <span className="game-entry-name" data-tooltip={game.name} data-tooltip-overflow="">
               {game.name}
            </span>
            <span className="game-executables" data-tooltip={game.executables.join(", ")} data-tooltip-overflow="">
               {game.executables.join(", ")}
            </span>
         </div>
         {game.added && (
            <IconButton
               label={`Remove game ${game.name}`}
               onClick={() => change(preferences.customGames.filter((item) => executableKey(item.executable) !== executableKey(game.executables[0]!)))}
            >
               <Trash2 size={15} />
            </IconButton>
         )}
      </div>
   );
   return (
      <div className="game-settings">
         <div className="game-toolbar">
            <label className="game-search">
               <Search size={16} />
               <input
                  ref={searchRef}
                  aria-label="Search games"
                  spellCheck={false}
                  placeholder="Search games or applications"
                  value={query}
                  onChange={(event) => {
                     setQuery(event.target.value);
                     setLimit(80);
                  }}
               />
            </label>
            <Button onClick={() => setAdding(true)} disabled={preferences.customGames.length >= 500}>
               <Plus size={16} />
               Add game
            </Button>
         </div>
         {visibleEntries.some((game) => game.added) && (
            <section className="game-group" aria-label="Added games">
               <h3 className="game-category">Added games</h3>
               <div className="game-list" role="list" aria-label="Added games">
                  <MotionList items={visibleEntries.filter((game) => game.added)}>{renderGame}</MotionList>
               </div>
            </section>
         )}
         <div className="game-list-summary">
            <span>
               {catalog ? `${filtered.filter((game) => !game.added).length.toLocaleString()} games` : error ? "Catalogue unavailable" : "Loading games…"}
            </span>
            {catalog && <span>{catalog.source === "saved" ? "Saved catalogue" : "Built-in catalogue"}</span>}
         </div>
         {error && (
            <p className="game-error" role="alert">
               {error}
            </p>
         )}
         {/* Search results slide and fade like the Library's lists instead of jumping. */}
         <div className="game-list" role="list" aria-label="Games">
            <MotionList items={visibleEntries.filter((game) => !game.added)} identity={catalog ? "ready" : "loading"}>
               {renderGame}
            </MotionList>
         </div>
         {catalog && !filtered.length && <p className="game-empty">No matching games.</p>}
         <div ref={sentinel} aria-hidden="true" />
         {adding && (
            <AddGameDialog
               additions={preferences.customGames}
               add={(game) => {
                  change(withAddedGame(preferences.customGames, game));
                  setQuery(game.name);
                  setLimit(80);
               }}
               close={() => setAdding(false)}
            />
         )}
      </div>
   );
}
