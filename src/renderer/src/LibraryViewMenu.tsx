import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import type { LibrarySort } from "./library-index";
import type { LibraryGrouping } from "./library-groups";
import { groupingOptions, sortFields, viewSummary } from "./library-view";
import { Menu, MenuRadioGroup, MenuRadioItem } from "./ui";

/** Sorting and grouping share one compact control. The group headers show the grouping. */
export function LibraryViewMenu({
   sort,
   grouping,
   onSort,
   onGroup,
}: {
   sort: LibrarySort;
   grouping: LibraryGrouping;
   onSort: (sort: LibrarySort) => void;
   onGroup: (grouping: LibraryGrouping) => void;
}) {
   const field = sortFields.find((option) => option.value === sort.field)!;
   const Direction = sort.reversed ? ArrowUpNarrowWide : ArrowDownWideNarrow;
   return (
      <Menu label="Sort and group" title={viewSummary(sort, grouping)} className="library-view-menu" trigger={<Direction size={17} />}>
         <MenuRadioGroup label="Sort by">
            {sortFields.map(({ value, label, icon: Icon }) => (
               // Choosing a field starts in its natural direction.
               <MenuRadioItem
                  key={value}
                  checked={sort.field === value}
                  onClick={() => onSort({ field: value, reversed: sort.field === value && sort.reversed })}
               >
                  <Icon size={15} />
                  {label}
               </MenuRadioItem>
            ))}
         </MenuRadioGroup>
         <div className="menu-separator" role="separator" />
         <MenuRadioGroup label="Order">
            {field.directions.map((label, index) => {
               const Icon = index ? ArrowUpNarrowWide : ArrowDownWideNarrow;
               return (
                  <MenuRadioItem key={label} checked={sort.reversed === (index === 1)} onClick={() => onSort({ ...sort, reversed: index === 1 })}>
                     <Icon size={15} />
                     {label}
                  </MenuRadioItem>
               );
            })}
         </MenuRadioGroup>
         <div className="menu-separator" role="separator" />
         <MenuRadioGroup label="Group by">
            {groupingOptions.map(({ value, label, icon: Icon }) => (
               <MenuRadioItem key={value} checked={grouping === value} onClick={() => onGroup(value)}>
                  <Icon size={15} />
                  {label}
               </MenuRadioItem>
            ))}
         </MenuRadioGroup>
      </Menu>
   );
}
