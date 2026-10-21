import { useState } from "react";
import {
   Tag,
   Gamepad2,
   Star,
   Heart,
   Trophy,
   Bookmark,
   Film,
   Music,
   Camera,
   Coffee,
   Cat,
   Dog,
   Flag,
   Flame,
   Flower,
   Folder,
   Gift,
   Globe,
   Headphones,
   Home,
   Lightbulb,
   Rocket,
   Shield,
   Smile,
   Sparkles,
   Sun,
   Target,
   Users,
   Video,
   Zap,
   ChevronDown,
   Pipette,
} from "lucide-react";
import type { Category } from "../../shared/types";
import { Button, Menu } from "./ui";
import { DialogPanel } from "./Dialog";
import { api } from "./desktop";
import type { Run } from "./desktop";
const icons = {
   tag: Tag,
   game: Gamepad2,
   star: Star,
   heart: Heart,
   trophy: Trophy,
   bookmark: Bookmark,
   film: Film,
   music: Music,
   camera: Camera,
   coffee: Coffee,
   cat: Cat,
   dog: Dog,
   flag: Flag,
   flame: Flame,
   flower: Flower,
   folder: Folder,
   gift: Gift,
   globe: Globe,
   headphones: Headphones,
   home: Home,
   idea: Lightbulb,
   rocket: Rocket,
   shield: Shield,
   smile: Smile,
   sparkles: Sparkles,
   sun: Sun,
   target: Target,
   users: Users,
   video: Video,
   zap: Zap,
};
export function CategoryMark({ category, size = 16 }: { category: Pick<Category, "color" | "icon">; size?: number }) {
   const Icon = icons[category.icon as keyof typeof icons] ?? Tag;
   const rgb = /^#[0-9a-f]{6}$/i.test(category.color) ? [1, 3, 5].map((index) => parseInt(category.color.slice(index, index + 2), 16)) : [177, 151, 252];
   const color = Math.max(...rgb) < 110 ? `rgb(${rgb.map((channel) => Math.round(channel * 0.45 + 255 * 0.55)).join(",")})` : category.color;
   return <Icon size={size} style={{ color: `var(--category-ink, ${color})` }} aria-hidden="true" />;
}
export function CategoryEditor({ category, close, run }: { category?: Category | undefined; close: () => void; run: Run }) {
   const [name, setName] = useState(category?.name ?? ""),
      [color, setColor] = useState(category?.color ?? "#b197fc"),
      [icon, setIcon] = useState(category?.icon ?? "tag"),
      [busy, setBusy] = useState(false);
   const save = async () => {
      setBusy(true);
      if (await run(() => api.category(category ? "update" : "create", { ...(category ? { id: category.id } : {}), name: name.trim(), color, icon }))) close();
      setBusy(false);
   };
   return (
      <DialogPanel title={category ? "Edit category" : "New category"} close={close} className="category-editor" closeLabel="Close category editor">
         <form
            onSubmit={(event) => {
               event.preventDefault();
               void save();
            }}
         >
            <label className="category-name-input">
               <CategoryMark category={{ color, icon }} size={20} />
               <input autoFocus aria-label="Category name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <div className="category-icon-choices" role="group" aria-label="Category icon">
               {Object.entries(icons)
                  .slice(0, 6)
                  .map(([id, Icon]) => (
                     <button type="button" key={id} aria-label={`Icon: ${id}`} aria-pressed={icon === id} onClick={() => setIcon(id)}>
                        <Icon size={20} />
                     </button>
                  ))}
               <Menu label="More category icons" className="category-icon-more" columns={6} trigger={<ChevronDown size={18} />}>
                  {Object.entries(icons).map(([id, Icon]) => (
                     <button type="button" role="menuitemradio" key={id} aria-label={`Icon: ${id}`} aria-checked={icon === id} onClick={() => setIcon(id)}>
                        <Icon size={20} />
                     </button>
                  ))}
               </Menu>
            </div>
            <div className="category-color-choices" role="group" aria-label="Category color">
               {["#b197fc", "#77b9ef", "#73c6a1", "#e3bd68", "#ed9579", "#db8eb9"].map((value) => (
                  <button type="button" key={value} aria-label={`Color ${value}`} aria-pressed={color === value} onClick={() => setColor(value)}>
                     <span aria-hidden="true" style={{ background: value }} />
                  </button>
               ))}
               <label
                  className="category-custom-swatch"
                  title="Choose a custom color"
                  data-selected={!["#b197fc", "#77b9ef", "#73c6a1", "#e3bd68", "#ed9579", "#db8eb9"].includes(color) || undefined}
               >
                  <span aria-hidden="true" style={{ background: color }}>
                     <Pipette size={16} />
                  </span>
                  <input type="color" aria-label="Custom category color" value={color} onChange={(event) => setColor(event.target.value)} />
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
