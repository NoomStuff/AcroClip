// Copyright (c) 2026 NoomStuff. MIT. Adapted from AttaCut UpdateChip.
// See THIRD_PARTY_NOTICES.md.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, FolderOpen, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import type { UpdateState } from "../../shared/types";
import "./UpdateChip.css";
import { api } from "./desktop";
import type { Run } from "./desktop";
import { updateAction, updateDownloading, updateDownloadLabel } from "./update-action";

interface Props {
   state: UpdateState;
   run: Run;
}

const ringLength = 53.4;

export function UpdateChip({ state, run }: Props) {
   const [announce, setAnnounce] = useState(true);
   const [expandedWidth, setExpandedWidth] = useState(160);
   const labelRef = useRef<HTMLSpanElement>(null);
   const downloadWidthRef = useRef<HTMLSpanElement>(null);
   const phase = state.state;
   const downloading = updateDownloading(state);
   const percent = state.indeterminate ? null : state.progress;
   const action = updateAction(state);
   const label = downloading ? updateDownloadLabel(state) : (action?.label ?? state.message);
   const Icon = phase === "downloaded" ? FolderOpen : phase === "error" ? TriangleAlert : Download;

   useEffect(() => {
      setAnnounce(true);
      const timer = window.setTimeout(() => setAnnounce(false), 3400);
      return () => window.clearTimeout(timer);
   }, [state.version, phase]);

   useLayoutEffect(() => {
      const labelWidth = labelRef.current?.scrollWidth ?? 0;
      const downloadWidth = downloadWidthRef.current?.scrollWidth ?? 0;
      setExpandedWidth(34 + (downloading ? Math.max(labelWidth, downloadWidth) : labelWidth));
   }, [label, downloading]);

   return (
      <div className={`update-chip-wrap${announce ? " announce" : ""}`}>
         <button
            type="button"
            className={`update-chip-trigger ${phase}`}
            aria-label={label}
            aria-disabled={!action}
            title={phase === "error" && state.message ? state.message : `AcroClip ${state.version} · ${label}`}
            onClick={action ? () => void run(() => api[action.method]()) : undefined}
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
