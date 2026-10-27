import { useEffect, useState } from "react";
import { api } from "./desktop";

export function useAttaCutAvailable(visible: boolean): boolean {
   const [attaCutAvailable, setAttaCutAvailable] = useState(false);
   useEffect(() => {
      if (!visible) return;
      let active = true;
      const detect = () => {
         void api
            .attaCutAvailable()
            .then((available) => {
               if (active) setAttaCutAvailable(available);
            })
            .catch(() => {
               if (active) setAttaCutAvailable(false);
            });
      };
      detect();
      window.addEventListener("focus", detect);
      return () => {
         active = false;
         window.removeEventListener("focus", detect);
      };
   }, [visible]);
   return attaCutAvailable;
}
