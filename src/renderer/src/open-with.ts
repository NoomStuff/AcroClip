import { useEffect, useState } from "react";
import type { OpenWithList } from "../../shared/types";
import { api } from "./desktop";

/**
 * Open with lists, by file type. A menu shows the last list at once and asks again as it opens, so
 * an app installed meanwhile turns up without the menu waiting on it.
 */
const lists = new Map<string, OpenWithList>();
const requests = new Map<string, Promise<OpenWithList>>();
const fileType = (path: string) => (/\.[^.\\/]+$/.exec(path)?.[0] ?? "").toLowerCase();

export function loadOpenWith(path: string): Promise<OpenWithList> {
   const type = fileType(path);
   let request = requests.get(type);
   if (!request) {
      request = Promise.resolve()
         .then(() => api.openWithApps(path))
         .then((list) => {
            lists.set(type, list);
            return list;
         })
         .finally(() => requests.delete(type));
      requests.set(type, request);
   }
   return request;
}

/** The apps for this file, or null until the system has answered once for its type. */
export function useOpenWith(path: string | undefined): OpenWithList | null {
   const type = path ? fileType(path) : "";
   const [answer, setAnswer] = useState(() => ({ type, list: lists.get(type) ?? null }));
   useEffect(() => {
      if (!path) return;
      let live = true;
      void loadOpenWith(path).then(
         (list) => live && setAnswer({ type, list }),
         () => undefined
      );
      return () => {
         live = false;
      };
   }, [path, type]);
   if (!path) return null;
   return answer.type === type ? answer.list : (lists.get(type) ?? null);
}
