import { useEffect, useRef, useState } from "react";
import type { Preferences } from "../../shared/types";
import { api, describeError } from "./desktop";
type Status = "idle" | "saving" | "saved" | "error";
/** Waits before each automatic retry of a failed save. After the last one, Retry is up to the user. */
const retryDelays = [1000, 3000, 8000];

/**
 * Saves settings as they change. Main applies what it can and keeps changes capture holds back,
 * which arrive in `pending` and apply on their own once capture allows them. A failed save
 * retries by itself a few times before it waits for the user.
 */
export function useSettingsAutosave(preferences: Preferences, pending: Partial<Preferences>) {
   const shown = (saved: Preferences, waiting: Partial<Preferences>) => ({ ...saved, ...waiting });
   const [draft, setDraft] = useState(() => shown(preferences, pending));
   const [status, setStatus] = useState<Status>("idle");
   const [error, setError] = useState("");
   const [retrying, setRetrying] = useState(false);
   const current = useRef(draft);
   const edits = useRef(new Map<keyof Preferences, number>());
   const revision = useRef(0);
   const running = useRef(false);
   const alive = useRef(true);
   const failures = useRef(0);
   const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const publish = (value: Preferences) => {
      current.current = value;
      if (alive.current) setDraft(value);
   };
   // Local edits stay on top of what main reports until they are saved.
   const withEdits = (base: Preferences) => {
      const merged = { ...base };
      for (const key of edits.current.keys()) Object.assign(merged, { [key]: current.current[key] });
      return merged;
   };
   useEffect(() => {
      publish(withEdits(shown(preferences, pending)));
   }, [preferences, pending]);
   const flush = async () => {
      clearTimeout(timer.current);
      clearTimeout(retryTimer.current);
      if (running.current || !edits.current.size) return;
      running.current = true;
      if (alive.current) {
         setStatus("saving");
         setError("");
         setRetrying(false);
      }
      try {
         while (edits.current.size) {
            const snapshot = new Map(edits.current);
            // Main validates and normalizes every save, and keeps what capture holds back.
            const result = await api.autosavePreferences(current.current, [...snapshot.keys()]);
            for (const [key, version] of snapshot) if (edits.current.get(key) === version) edits.current.delete(key);
            publish(withEdits(shown(result.state.preferences, result.state.pendingPreferences)));
         }
         failures.current = 0;
         if (alive.current) {
            setStatus("saved");
            checkTimer.current = setTimeout(() => {
               if (alive.current) setStatus("idle");
            }, 1600);
         }
      } catch (reason) {
         const delay = retryDelays[failures.current++];
         if (alive.current) {
            setError(describeError(reason));
            setStatus("error");
            setRetrying(delay !== undefined);
         }
         if (delay !== undefined) retryTimer.current = setTimeout(() => void flushRef.current(), delay);
      } finally {
         running.current = false;
      }
   };
   const write = (next: Preferences) => {
      clearTimeout(timer.current);
      clearTimeout(checkTimer.current);
      clearTimeout(retryTimer.current);
      failures.current = 0;
      const version = ++revision.current;
      for (const key of Object.keys(next) as Array<keyof Preferences>) {
         if (JSON.stringify(next[key]) !== JSON.stringify(current.current[key])) edits.current.set(key, version);
      }
      publish(next);
      setStatus(running.current ? "saving" : "idle");
      setError("");
      setRetrying(false);
      timer.current = setTimeout(() => void flush(), 350);
   };
   const flushRef = useRef(flush);
   flushRef.current = flush;
   useEffect(() => {
      alive.current = true;
      return () => {
         alive.current = false;
         clearTimeout(timer.current);
         clearTimeout(checkTimer.current);
         clearTimeout(retryTimer.current);
         void flushRef.current();
      };
   }, []);
   const retry = () => {
      failures.current = 0;
      void flush();
   };
   // Saves a waiting change now, so an action that replaces every setting goes last.
   return { draft, write, status, error, retrying, retry, flush: () => flushRef.current() };
}
