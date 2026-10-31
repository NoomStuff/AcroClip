import { useState } from "react";
import { Folder, FolderInput } from "lucide-react";
import { DialogPanel } from "./Dialog";
import { FolderTree } from "./FolderTree";
import { Button } from "./ui";
import { describeError } from "./desktop";

export function MoveDialog({
   title,
   folders,
   initial,
   excluded,
   close,
   submit,
}: {
   title: string;
   folders: string[];
   initial: string;
   excluded?: string | undefined;
   close: () => void;
   submit: (destination: string) => Promise<void>;
}) {
   const [destination, setDestination] = useState(initial);
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState("");
   const available = folders.filter((path) => !excluded || (path !== excluded && !path.startsWith(`${excluded}/`)));
   const move = async () => {
      setBusy(true);
      setError("");
      try {
         await submit(destination);
         close();
      } catch (error) {
         setError(describeError(error));
      } finally {
         setBusy(false);
      }
   };
   return (
      <DialogPanel
         title={title}
         close={() => {
            if (!busy) close();
         }}
         className="move-dialog"
      >
         <div className="move-folders" inert={busy}>
            <button className={`sidebar-item ${destination === "" ? "selected" : ""}`} aria-pressed={destination === ""} onClick={() => setDestination("")}>
               <Folder size={16} />
               Collection
            </button>
            <FolderTree paths={available} selected={destination} onSelect={setDestination} />
         </div>
         <p className="move-destination">{destination || "Collection"}</p>
         {error && <p role="alert">{error}</p>}
         <div className="dialog-actions">
            <Button disabled={busy} onClick={close}>
               Cancel
            </Button>
            <Button className="primary" disabled={busy || (!!excluded && initial === destination)} onClick={() => void move()}>
               <FolderInput size={16} />
               {busy ? "Moving…" : "Move here"}
            </Button>
         </div>
      </DialogPanel>
   );
}
