import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * The ids that weren't in the list on the previous render. Nothing counts as new on the first render,
 * so tags already on a clip when its card or player view first shows stay still.
 */
export function useNewTags(ids: readonly string[]): ReadonlySet<string> {
   const known = useRef<ReadonlySet<string> | null>(null);
   const key = ids.join("\n");
   useEffect(() => {
      known.current = new Set(key ? key.split("\n") : []);
   }, [key]);
   const previous = known.current;
   return previous ? new Set(ids.filter((id) => !previous.has(id))) : new Set();
}

/** One tag that pops in if it was new when it mounted. Later renders never replay it. */
export function TagArrival({ fresh, className, style, children }: { fresh: boolean; className: string; style?: CSSProperties; children: ReactNode }) {
   const [arriving] = useState(fresh);
   return (
      <span className={className} style={style} data-arriving={arriving || undefined}>
         {children}
      </span>
   );
}
