import { existsSync } from "node:fs";
import { posix } from "node:path";

// Mesa and VAAPI drivers belong to the host. Loading their system dependencies
// first prevents an older bundled Wayland/C++ library from breaking new drivers.
export function linuxRecorderEnvironment(
   root: string,
   environment: NodeJS.ProcessEnv = process.env,
   architecture: string = process.arch,
   exists: (file: string) => boolean = existsSync
): NodeJS.ProcessEnv {
   const triplet = architecture === "arm64" ? "aarch64-linux-gnu" : "x86_64-linux-gnu";
   const directories = [`/usr/lib/${triplet}`, `/lib/${triplet}`, "/usr/lib64", "/usr/lib", "/lib64", "/lib"];
   const names = [
      "libgcc_s.so.1",
      "libstdc++.so.6",
      "libdrm.so.2",
      "libgbm.so.1",
      "libwayland-client.so.0",
      "libwayland-server.so.0",
      "libva.so.2",
      "libva-drm.so.2",
      "libva-x11.so.2",
   ];
   const host = names.flatMap((name) => {
      const file = directories.map((directory) => posix.join(directory, name)).find(exists);
      return file ? [file] : [];
   });
   return {
      ...environment,
      LD_LIBRARY_PATH: [posix.join(root, "lib"), environment["LD_LIBRARY_PATH"]].filter(Boolean).join(":"),
      ...(host.length ? { LD_PRELOAD: [environment["LD_PRELOAD"], ...host].filter(Boolean).join(":") } : {}),
   };
}
