// Match native/wayland/platform.cpp so Electron never opens an independent
// portal picker when the recorder already owns the capture session.
export function isWaylandSession(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
   return platform === "linux" && (Boolean(environment["WAYLAND_DISPLAY"]) || environment["XDG_SESSION_TYPE"] === "wayland");
}
