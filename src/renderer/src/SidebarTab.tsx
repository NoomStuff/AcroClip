import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";

type DataAttributes = { [attribute: `data-${string}`]: string | number | boolean | undefined };

/**
 * One tab in a sidebar list, the same everywhere: Settings sections, library filters and folders,
 * and audio filters. The count sits in the action column at the end, and row actions such as a
 * menu take its place while the row is hovered. `.sidebar-row` in ui.css owns the shared behavior.
 */
export function SidebarTab({
   icon,
   label,
   selected,
   onSelect,
   selection = "pressed",
   count,
   after,
   actions,
   leading,
   tooltip,
   className = "",
   tabClassName = "",
   tabStyle,
   tabAttributes,
   rowAttributes,
}: {
   icon: ReactNode;
   label: string;
   selected: boolean;
   onSelect: () => void;
   /** "page" for navigation between pages, "pressed" for a filter or a choice, "none" when the row reports it, as a tree item does. */
   selection?: "page" | "pressed" | "none";
   count?: ReactNode;
   /** Marks after the label, such as a filter that is off. */
   after?: ReactNode;
   /** Usually a Menu. Appears over the count on hover. */
   actions?: ReactNode;
   /** Before the tab, such as a folder's expand arrow. */
   leading?: ReactNode;
   /** Shown when the label doesn't fit. Defaults to the label. */
   tooltip?: string;
   className?: string;
   tabClassName?: string;
   tabStyle?: CSSProperties;
   tabAttributes?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "onClick" | "children"> & DataAttributes;
   rowAttributes?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "children"> & DataAttributes;
}) {
   return (
      <div {...rowAttributes} className={`sidebar-row ${className}`}>
         {leading}
         <button
            type="button"
            data-list-control=""
            {...tabAttributes}
            className={`sidebar-item ${selected ? "selected" : ""} ${tabClassName}`}
            style={tabStyle}
            aria-pressed={selection === "pressed" ? selected : undefined}
            aria-current={selection === "page" && selected ? "page" : undefined}
            onClick={onSelect}
         >
            {icon}
            <span className="sidebar-label" data-tooltip={tooltip ?? label} data-tooltip-overflow="">
               {label}
            </span>
            {after}
            {count !== undefined && (
               <span className="count">
                  <span>{count}</span>
               </span>
            )}
         </button>
         {actions}
      </div>
   );
}
