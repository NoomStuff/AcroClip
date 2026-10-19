import { useState } from "react";
import { AppWindow } from "lucide-react";
export function ApplicationIcon({ src, size = 16 }: { src?: string | undefined; size?: number }) {
   const [failed, setFailed] = useState<string>(),
      [loaded, setLoaded] = useState<string>();
   const image = src?.startsWith("data:image/png;base64,") && src !== failed ? src : undefined;
   return (
      <span className="application-icon" style={{ width: size, height: size }} aria-hidden="true">
         <AppWindow size={size} style={{ visibility: image && loaded === image ? "hidden" : "visible" }} />
         {image && (
            <img
               src={image}
               alt=""
               draggable={false}
               style={{ opacity: loaded === image ? 1 : 0 }}
               onLoad={() => setLoaded(image)}
               onError={() => setFailed(image)}
            />
         )}
      </span>
   );
}
