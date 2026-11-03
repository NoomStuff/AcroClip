import { useEffect, useRef, useState } from "react";

export function audioWarningDelay(message: string): number {
   if (!message) return 0;
   return /(?:^|:\s*)Audio capture is (?:starting|reconnecting)\.?$/i.test(message) || /^Waiting for audio source /i.test(message) ? 5000 : 1200;
}

export function useAudioWarning(message: string): string {
   const [settled, setSettled] = useState("");
   const since = useRef<number | null>(null);
   useEffect(() => {
      setSettled("");
      if (!message) {
         since.current = null;
         return;
      }
      since.current ??= Date.now();
      const remaining = Math.max(0, audioWarningDelay(message) - (Date.now() - since.current));
      const timer = window.setTimeout(() => setSettled(message), remaining);
      return () => window.clearTimeout(timer);
   }, [message]);
   return settled === message ? settled : "";
}
