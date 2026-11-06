import type { GameCandidate, RecorderState } from "../../shared/types";

export function autoCapturePresentation(games: readonly GameCandidate[], recorder: RecorderState, ready: boolean) {
   const finding = recorder.supported && !ready;
   const eligible = ready ? games.filter((game) => game.gameName) : [];
   const handle = recorder.sourceId?.startsWith("window:") ? recorder.sourceId.split(":")[1] : undefined;
   const matching =
      recorder.sourceKind === "app"
         ? eligible.find((game) => game.id === recorder.sourceId || (handle && game.id.startsWith("window:") && game.id.split(":")[1] === handle))
         : undefined;
   const active = recorder.state === "recording" || recorder.state === "waiting";
   const game = (active ? matching : undefined) ?? eligible.find((item) => item.foreground) ?? eligible[0];
   const recording = recorder.state === "recording" && !!matching;
   const name = recording ? recorder.sourceName || game?.gameName : game?.gameName;
   return {
      game,
      finding,
      name,
      title: name || (finding ? "Finding games" : "No game detected"),
      label: recording ? "Capturing game" : game ? (recorder.state === "waiting" ? "Waiting for game" : "Detected game") : "Auto capture",
      previewApplication: !finding && active && !!matching,
   };
}
