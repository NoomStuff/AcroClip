import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Headphones } from "lucide-react";
import { api, describeError, reportFeedback } from "./desktop";
import { IconButton } from "./ui";
import type { Preferences } from "../../shared/types";
const Context = createContext<{ listening: string | null; disabled: boolean; busy: boolean; reason: string; toggle: (id: string) => void }>({
   listening: null,
   disabled: true,
   busy: false,
   reason: "Open Recording to listen",
   toggle: () => {},
});
export function ListenButton({ id, name, enabled }: { id: string; name: string; enabled: boolean }) {
   const context = useContext(Context),
      on = context.listening === id;
   return (
      <IconButton
         label={context.disabled && context.reason ? `${context.reason}: ${name}` : `${on ? "Stop listening to" : "Listen to"} ${name}`}
         aria-pressed={on}
         aria-busy={context.busy}
         disabled={context.disabled || !enabled}
         className={on ? "audio-listen active" : "audio-listen"}
         onClick={() => context.toggle(id)}
      >
         <Headphones size={18} />
      </IconButton>
   );
}
export function useIsListening(id: string): boolean {
   return useContext(Context).listening === id;
}
export function AudioListening({
   children,
   active,
   visible,
   preferences,
   platform,
}: {
   children: ReactNode;
   active: boolean;
   visible: boolean;
   preferences: Preferences;
   platform: string;
}) {
   const [listening, setListening] = useState<string | null>(null),
      [busy, setBusy] = useState(false);
   const generation = useRef(0),
      current = useRef(listening);
   current.current = listening;
   const invalidate = useCallback(() => {
      generation.current += 1;
   }, []);
   const identity = JSON.stringify([
      preferences.sourceKind,
      preferences.sourceId,
      preferences.microphone,
      preferences.microphoneDevice,
      preferences.captureAudio,
      preferences.audioSources.map(({ id, kind, sourceId, deviceId, enabled }) => ({ id, kind, sourceId, deviceId, enabled })),
   ]);
   useEffect(() => {
      invalidate();
      setListening(null);
      setBusy(false);
      void api.listenAudio(null).catch(() => undefined);
      return () => {
         invalidate();
         void api.listenAudio(null).catch(() => undefined);
      };
   }, [active, visible, identity, invalidate]);
   useEffect(
      () =>
         api.onEvent((event) => {
            if (event.type === "audio-monitor" && event.listeningError) {
               invalidate();
               if (current.current) reportFeedback({ kind: "notice", error: true, message: `Listening stopped. ${event.listeningError}` });
               setListening(null);
               setBusy(false);
               void api.listenAudio(null).catch(() => undefined);
            }
         }),
      [invalidate]
   );
   const toggle = async (id: string) => {
      if (busy) return;
      const token = ++generation.current;
      const next = listening === id ? null : id;
      setBusy(true);
      try {
         await api.listenAudio(next);
         if (token === generation.current) setListening(next);
      } catch (reason) {
         if (token === generation.current) {
            setListening(null);
            reportFeedback({ kind: "notice", error: true, message: describeError(reason) });
         }
      } finally {
         if (token === generation.current) setBusy(false);
      }
   };
   return (
      <Context.Provider
         value={{
            listening,
            busy,
            disabled: busy || !visible || platform !== "win32",
            reason: platform !== "win32" ? "Listening is available on Windows only" : !visible ? "Open Recording to listen" : "",
            toggle: (id) => void toggle(id),
         }}
      >
         {children}
      </Context.Provider>
   );
}
