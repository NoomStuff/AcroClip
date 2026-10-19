// Copyright (c) 2026 NoomStuff. MIT. Adapted from AttaCut UpdateChip.
// See licenses/AttaCut-MIT.txt.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Download, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import type { AvailableUpdate, UpdateStatus } from "../../shared/types";
import "./UpdateChip.css";

interface Props {
   update: AvailableUpdate;
   status: UpdateStatus | null;
   onDownload: () => void;
   onRestart: () => void;
   onRelease: () => void;
   onReveal: () => void;
}

const ringLength = 53.4;

export function UpdateChip({ update, status, onDownload, onRestart, onRelease, onReveal }: Props) {
   const [announce, setAnnounce] = useState(true);
   const [expandedWidth, setExpandedWidth] = useState(160);
   const labelRef = useRef<HTMLSpanElement>(null);
   const downloadWidthRef = useRef<HTMLSpanElement>(null);
   const phase = status?.version === update.version ? status.phase : null;
   const downloading = phase === "downloading" || (update.mode === "automatic" && !phase);
   const percent = status?.version === update.version ? status.percent : null;
   const label = downloading
      ? percent == null
         ? "Downloading update"
         : `Downloading ${Math.round(percent)}%`
      : phase === "ready"
        ? "Apply and restart"
        : phase === "downloaded"
          ? "Show in Downloads"
          : phase === "error"
            ? update.mode === "download"
               ? "Retry download"
               : "View release"
            : update.mode === "releases"
              ? "View release"
              : "Download update";
   const Icon = phase === "ready" || phase === "downloaded" ? Check : phase === "error" ? TriangleAlert : Download;
   const action = downloading
      ? undefined
      : phase === "ready"
        ? onRestart
        : phase === "downloaded"
          ? onReveal
          : phase === "error"
            ? update.mode === "download"
               ? onDownload
               : onRelease
            : update.mode === "releases"
              ? onRelease
              : onDownload;

   useEffect(() => {
      setAnnounce(true);
      const timer = window.setTimeout(() => setAnnounce(false), 3400);
      return () => window.clearTimeout(timer);
   }, [update.version, phase]);

   useLayoutEffect(() => {
      const labelWidth = labelRef.current?.scrollWidth ?? 0;
      const downloadWidth = downloadWidthRef.current?.scrollWidth ?? 0;
      setExpandedWidth(34 + (downloading ? Math.max(labelWidth, downloadWidth) : labelWidth));
   }, [label, downloading]);

   return (
      <div className={`update-chip-wrap${announce ? " announce" : ""}`}>
         <button
            type="button"
            className={`update-chip-trigger${phase ? ` ${phase}` : ""}`}
            aria-label={label}
            aria-disabled={!action}
            title={phase === "error" && status?.message ? status.message : `AcroClip ${update.version} · ${label}`}
            onClick={action}
            style={{ "--update-expanded-width": `${expandedWidth}px` } as CSSProperties}
         >
            <span className="update-chip-icon" aria-hidden="true">
               {downloading ? (
                  <svg className={`update-chip-ring${percent == null ? " indeterminate" : ""}`} viewBox="0 0 24 24">
                     <circle className="update-chip-ring-track" cx="12" cy="12" r="8.5" />
                     <circle className="update-chip-ring-fill" cx="12" cy="12" r="8.5" style={{ strokeDashoffset: ringLength * (1 - (percent ?? 25) / 100) }} />
                  </svg>
               ) : (
                  <Icon size={12} />
               )}
            </span>
            <span ref={labelRef} className="update-chip-label">
               {label}
            </span>
            <span ref={downloadWidthRef} className="update-chip-measure">
               Downloading 100%
            </span>
         </button>
      </div>
   );
}
