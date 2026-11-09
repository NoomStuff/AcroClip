import { Settings2 } from "lucide-react";
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
] as const;

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
   const ordered = [...sections].sort((a, b) => Number(b.id === page) - Number(a.id === page));
   return (
      <DialogPanel title="Keyboard shortcuts" close={close} className="shortcut-sheet" closeLabel="Close shortcuts">
         <div className="shortcut-sheet-grid">
            {ordered.map((section) => {
               const items = shortcutRegistry.filter((item) => section.test(item) && item.id !== "shortcutHelp");
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
               <Settings2 size={15} />
               Change shortcuts
            </Button>
         </div>
      </DialogPanel>
   );
}
