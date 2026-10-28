import type { ApplicationArtwork, CaptureSource } from "../shared/types";
import type { bufferedCaptureSource } from "../shared/capture-policy";

export interface RecordingArtwork {
   sourceId: string;
   application: ApplicationArtwork;
}

export function recordingArtwork(
   footage: ReturnType<typeof bufferedCaptureSource>,
   sources: CaptureSource[],
   previous?: RecordingArtwork
): RecordingArtwork | undefined {
   if (footage.kind !== "app" || !footage.id) return undefined;
   const sourceId = footage.id.split(":")[1];
   if (!sourceId) return undefined;
   const actual = sources.find((source) => source.kind === "app" && source.id.split(":")[1] === sourceId);
   if (actual?.applicationId) return { sourceId, application: { id: actual.applicationId, icon: actual.appIcon ?? "" } };
   // Hidden and minimized windows can disappear from desktop enumeration while
   // their buffered footage still belongs to the same application.
   return previous?.sourceId === sourceId ? previous : undefined;
}
