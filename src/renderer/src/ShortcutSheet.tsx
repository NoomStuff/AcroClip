import { Settings as Gear } from "lucide-react";
import type { Preferences } from "../../shared/types";
import { bindingFor, formatBinding, shortcutRegistry } from "../../shared/shortcuts";
import { DialogPanel } from "./Dialog";
import { Button } from "./ui";

type Page = "recording" | "library" | "viewer" | "settings";
const sections = [
   { id: "global", title: "While you play", test: (item: (typeof shortcutRegistry)[number]) => item.scope === "global" },
   { id: "all", title: "Anywhere in AcroClip", test: (item: (typeof shortcutRegistry)[number]) => item.scope === "local" && item.page === "all" },
   { id: "library", title: "Library", test: (item: (typeof shortcutRegistry)[number]) => item.scope === "local" && item.page === "library" },
   { id: "viewer", title: "Player", test: (item: (typeof shortcutRegistry)[number]) => item.scope === "local" && item.page === "viewer" },
   { id: "settings", title: "Settings", test: (item: (typeof shortcutRegistry)[number]) => item.scope === "local" && item.page === "settings" },
] as const;
type Section = (typeof sections)[number];
const listed = (section: Section) => shortcutRegistry.filter((item) => section.test(item) && item.id !== "shortcutHelp");

/**
 * Splits sections into two columns that stack on their own, picking the split whose taller column is shortest.
 * Each column keeps the given order, and the column holding the first section comes first.
 */
function balance(ordered: readonly Section[]): Section[][] {
   const height = (column: readonly Section[]) => column.reduce((total, section) => total + listed(section).length + 1.5, 0);
   let best: Section[][] = [[...ordered], []];
   for (let mask = 0; mask < 1 << ordered.length; mask++) {
      if (mask & 1) continue;
      const columns: Section[][] = [[], []];
      ordered.forEach((section, index) => columns[(mask >> index) & 1]!.push(section));
      if (Math.max(...columns.map(height)) < Math.max(...best.map(height))) best = columns;
   }
   return best.filter((column) => column.length);
}

/** Every shortcut with its current binding. The page you're on comes first. */
export function ShortcutSheet({
   preferences,
   page,
   mac,
   close,
   openSettings,
}: {
   preferences: Preferences;
   page: Page;
   mac: boolean;
   close: () => void;
   openSettings: () => void;
}) {
   const help = bindingFor(preferences, "shortcutHelp");
   const columns = balance([...sections].sort((a, b) => Number(b.id === page) - Number(a.id === page)));
   return (
      <DialogPanel title="Keyboard shortcuts" close={close} className="shortcut-sheet" closeLabel="Close shortcuts">
         <div className="shortcut-sheet-grid">
            {columns.map((column) => (
               <div key={column[0]!.id} className="shortcut-sheet-column">
                  {column.map((section) => {
                     const items = listed(section);
                     return (
                        <section key={section.id} className="shortcut-sheet-section" data-current={section.id === page || undefined}>
                           <h3>
                              {section.title}
                              {section.id === page && <span>This page</span>}
                           </h3>
                           <dl>
                              {items.map((item) => {
                                 const binding = bindingFor(preferences, item.id);
                                 return (
                                    <div key={item.id} data-unset={!binding || undefined}>
                                       <dt>{item.label}</dt>
                                       <dd>
                                          {binding ? (
                                             formatBinding(binding, mac)
                                                .split(" + ")
                                                .map((key) => <kbd key={key}>{key}</kbd>)
                                          ) : (
                                             <span className="shortcut-sheet-unset">Not set</span>
                                          )}
                                       </dd>
                                    </div>
                                 );
                              })}
                           </dl>
                        </section>
                     );
                  })}
               </div>
            ))}
         </div>
         <div className="shortcut-sheet-footer">
            {help ? (
               <span>
                  Press{" "}
                  {formatBinding(help, mac)
                     .split(" + ")
                     .map((key) => (
                        <kbd key={key}>{key}</kbd>
                     ))}{" "}
                  to open this anywhere.
               </span>
            ) : (
               <span>Open this again from Settings, Shortcuts.</span>
            )}
            <Button
               onClick={() => {
                  close();
                  openSettings();
               }}
            >
               <Gear size={15} />
               Change shortcuts
            </Button>
         </div>
      </DialogPanel>
   );
}
