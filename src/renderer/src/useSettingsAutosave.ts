import { useEffect, useRef, useState } from "react";
import type { Preferences } from "../../shared/types";
import { preferencesSchema } from "../../shared/validation";
import { api, describeError } from "./desktop";
type Status = "idle" | "saving" | "saved" | "error";
export function useSettingsAutosave(preferences: Preferences) {
   const [draft, setDraft] = useState(preferences);
   const [status, setStatus] = useState<Status>("idle");
   const [error, setError] = useState("");
   const current = useRef(preferences);
   const edits = useRef(new Map<keyof Preferences, number>());
   const revision = useRef(0);
   const running = useRef(false);
   const alive = useRef(true);
   const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const serialized = JSON.stringify(preferences);
   const publish = (value: Preferences) => {
      current.current = value;
      if (alive.current) setDraft(value);
   };
   useEffect(() => {
      const next = JSON.parse(serialized) as Preferences;
      const merged = { ...next };
      for (const key of edits.current.keys()) Object.assign(merged, { [key]: current.current[key] });
      publish(merged);
   }, [serialized]);
   const flush = async () => {
      clearTimeout(timer.current);
      if (running.current || !edits.current.size) return;
      const parsed = preferencesSchema.safeParse(current.current);
      if (!parsed.success) {
         if (alive.current) {
            setError(parsed.error.issues[0]?.message ?? "Check your settings.");
            setStatus("error");
         }
         return;
      }
      running.current = true;
      if (alive.current) {
         setStatus("saving");
         setError("");
      }
      try {
         while (edits.current.size) {
            const snapshot = new Map(edits.current);
            const values = { ...current.current };
            const latest = (await api.state()).preferences;
            const candidate = { ...latest };
            for (const key of snapshot.keys()) Object.assign(candidate, { [key]: values[key] });
            const valid = preferencesSchema.safeParse(candidate);
            if (!valid.success) throw new Error(valid.error.issues[0]?.message ?? "Check your settings.");
            const result = await api.savePreferences(valid.data);
            for (const [key, version] of snapshot) if (edits.current.get(key) === version) edits.current.delete(key);
            const merged = { ...result.preferences };
            for (const key of edits.current.keys()) Object.assign(merged, { [key]: current.current[key] });
            publish(merged);
         }
         if (alive.current) {
            setStatus("saved");
            checkTimer.current = setTimeout(() => {
               if (alive.current) setStatus("idle");
            }, 1600);
         }
      } catch (reason) {
         if (alive.current) {
            setError(describeError(reason));
            setStatus("error");
         }
      } finally {
         running.current = false;
      }
   };
   const write = (next: Preferences) => {
      clearTimeout(timer.current);
      clearTimeout(checkTimer.current);
      const version = ++revision.current;
      for (const key of Object.keys(next) as Array<keyof Preferences>) {
         if (JSON.stringify(next[key]) !== JSON.stringify(current.current[key])) edits.current.set(key, version);
      }
      publish(next);
      setStatus(running.current ? "saving" : "idle");
      setError("");
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
         void flushRef.current();
      };
   }, []);
   return { draft, write, status, error, retry: () => void flush() };
}
