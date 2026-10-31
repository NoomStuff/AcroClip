export const clipDragType = "application/x-acroclip-clip";
export interface ClipDrag {
   id: string;
   collection: string;
}
export function readCollectionDrag(value: string, collection: string): string | null {
   try {
      const payload: unknown = JSON.parse(value);
      if (!payload || typeof payload !== "object" || !("id" in payload) || !("collection" in payload)) return null;
      return typeof payload.id === "string" && payload.id.length > 0 && payload.id.length <= 512 && payload.collection === collection ? payload.id : null;
   } catch {
      return null;
   }
}
