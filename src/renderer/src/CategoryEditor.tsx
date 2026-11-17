import { useState } from "react";
import {
   Bomb,
   Bookmark,
   Bug,
   Camera,
   Car,
   Cat,
   ChevronDown,
   Clapperboard,
   Coffee,
   Crosshair,
   Crown,
   Dog,
   Eye,
   Film,
   Flag,
   Flame,
   Flower,
   Folder,
   Frown,
   Gamepad2,
   Ghost,
   Gift,
   Globe,
   Headphones,
   Heart,
   Home,
   Joystick,
   Laugh,
   Lightbulb,
   Medal,
   Mic,
   Mountain,
   Music,
   PartyPopper,
   Pin,
   Pipette,
   Puzzle,
   Rocket,
   Send,
   Shield,
   Skull,
   Smile,
   Sparkles,
   Star,
   Sun,
   Swords,
   Tag,
   Target,
   Timer,
   Trophy,
   Users,
   Video,
   WandSparkles,
   Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Category } from "../../shared/types";
import { Button, Menu } from "./ui";
import { DialogPanel } from "./Dialog";
import { api } from "./desktop";
import type { Run } from "./desktop";
import { categoryColors } from "./category-color";
// The picker's icons in order. The first row is always shown; the popup holds all of them.
const icons = {
   tag: Tag,
   game: Gamepad2,
   star: Star,
   heart: Heart,
   trophy: Trophy,
   bookmark: Bookmark,
   crosshair: Crosshair,
   laugh: Laugh,
   skull: Skull,
   crown: Crown,
   swords: Swords,
   flame: Flame,
   ghost: Ghost,
   zap: Zap,
   sparkles: Sparkles,
   smile: Smile,
   frown: Frown,
   party: PartyPopper,
   users: Users,
   mic: Mic,
   headphones: Headphones,
   send: Send,
   clapperboard: Clapperboard,
   film: Film,
   camera: Camera,
   music: Music,
   video: Video,
   flag: Flag,
   pin: Pin,
   timer: Timer,
   target: Target,
   medal: Medal,
   bomb: Bomb,
   shield: Shield,
   bug: Bug,
   eye: Eye,
   rocket: Rocket,
   car: Car,
   wand: WandSparkles,
   puzzle: Puzzle,
   joystick: Joystick,
   mountain: Mountain,
};
// Icon ids are stored in collection metadata. Ones the picker no longer offers keep rendering.
const retiredIcons = {
   coffee: Coffee,
   cat: Cat,
   dog: Dog,
   flower: Flower,
   folder: Folder,
   gift: Gift,
   globe: Globe,
   home: Home,
   idea: Lightbulb,
   sun: Sun,
};
const markIcons = new Map<string, LucideIcon>(Object.entries({ ...retiredIcons, ...icons }));
const colorNames: Record<string, string> = {
   "#b197fc": "Lavender",
   "#77b9ef": "Blue",
   "#73c6a1": "Mint",
   "#e3bd68": "Gold",
   "#ed9579": "Coral",
   "#db8eb9": "Pink",
};
const colors = ["#b197fc", "#77b9ef", "#73c6a1", "#e3bd68", "#ed9579", "#db8eb9"];
export function CategoryMark({ category, size = 16 }: { category: Pick<Category, "color" | "icon">; size?: number }) {
   const Icon = markIcons.get(category.icon ?? "") ?? Tag;
   return <Icon size={size} style={{ color: `var(--category-ink, ${categoryColors(category.color).ink})` }} aria-hidden="true" />;
}
export function CategoryEditor({
   category,
   clipId,
   close,
   run,
}: {
   category?: Category | undefined;
   /** The clip a new tag was started from. It gets the tag as part of creating it. */
   clipId?: string | undefined;
   close: () => void;
   run: Run;
}) {
   const [name, setName] = useState(category?.name ?? ""),
      [color, setColor] = useState(category?.color ?? "#b197fc"),
      [icon, setIcon] = useState(category?.icon ?? "tag"),
      [busy, setBusy] = useState(false);
   const save = async () => {
      setBusy(true);
      const request = { name: name.trim(), color, icon };
      if (
         await run(() =>
            category ? api.category("update", { id: category.id, ...request }) : api.category("create", { ...request, ...(clipId ? { clipId } : {}) })
         )
      )
         close();
      setBusy(false);
   };
   return (
      <DialogPanel title={category ? "Edit tag" : "New tag"} close={close} className="category-editor" closeLabel="Close tag editor">
         <form
            onSubmit={(event) => {
               event.preventDefault();
               void save();
            }}
         >
            <label className="category-name-input">
               <CategoryMark category={{ color, icon }} size={20} />
               <input
                  autoFocus
                  aria-label="Tag name"
                  placeholder="Tag name"
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
               />
            </label>
            <div className="category-icon-choices" role="group" aria-label="Tag icon">
               {Object.entries(icons)
                  .slice(0, 6)
                  .map(([id, Icon]) => (
                     <button type="button" key={id} aria-label={`Icon: ${id}`} aria-pressed={icon === id} onClick={() => setIcon(id)}>
                        <Icon size={20} />
                     </button>
                  ))}
               <Menu label="More tag icons" className="category-icon-more" columns={6} trigger={<ChevronDown size={18} />}>
                  {Object.entries(icons).map(([id, Icon]) => (
                     <button
                        type="button"
                        role="menuitemradio"
                        tabIndex={-1}
                        key={id}
                        aria-label={`Icon: ${id}`}
                        aria-checked={icon === id}
                        onClick={() => setIcon(id)}
                     >
                        <Icon size={20} />
                     </button>
                  ))}
               </Menu>
            </div>
            <div className="category-color-choices" role="group" aria-label="Tag color">
               {colors.map((value) => (
                  <button type="button" key={value} aria-label={`Color ${colorNames[value]}`} aria-pressed={color === value} onClick={() => setColor(value)}>
                     <span aria-hidden="true" style={{ background: value }} />
                  </button>
               ))}
               <label className="category-custom-swatch" data-selected={!colors.includes(color) || undefined}>
                  <span aria-hidden="true" style={{ background: color }}>
                     <Pipette size={16} />
                  </span>
                  <input type="color" aria-label="Custom tag color" value={color} onChange={(event) => setColor(event.target.value)} />
               </label>
            </div>
            <div className="dialog-actions">
               <Button type="button" onClick={close}>
                  Cancel
               </Button>
               <Button className="primary" busy={busy} disabled={!name.trim()} type="submit">
                  {category ? "Save" : "Create"}
               </Button>
            </div>
         </form>
      </DialogPanel>
   );
}
