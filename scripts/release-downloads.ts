import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export type ReleaseArchitecture = "x64" | "arm64";

export function appDownloadNames(version: string, linux: readonly ReleaseArchitecture[], mac: readonly ReleaseArchitecture[]): string[] {
   if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Pass a stable release version.");
   return [
      `AcroClip-${version}-win-x64-Installer.exe`,
      `AcroClip-${version}-win-x64.exe`,
      ...linux.map((arch) => `AcroClip-${version}-linux-${arch === "x64" ? "x86_64" : arch}.AppImage`),
      ...mac.flatMap((arch) => [`AcroClip-${version}-mac-${arch}.dmg`, `AcroClip-${version}-mac-${arch}.zip`]),
   ];
}

// Release uploads use this prepared directory, never a wildcard over build output.
// Corresponding sources, verification records and updater feeds have separate destinations.
export async function prepareDownloads(directory: string, destination: string, names: readonly string[]): Promise<void> {
   const entries = await readdir(directory, { withFileTypes: true });
   for (const name of names) {
      if (!entries.some((entry) => entry.name === name && entry.isFile())) throw new Error(`Missing app download: ${name}`);
   }
   await mkdir(destination, { recursive: true });
   if ((await readdir(destination)).length) throw new Error("Download destination must be empty.");
   for (const name of names) await copyFile(path.join(directory, name), path.join(destination, name));
}

if (import.meta.main) {
   const [version, directory, destination, coverage] = process.argv.slice(2);
   if (!version || !directory || !destination || (coverage !== "current" && coverage !== "all"))
      throw new Error("Usage: bun scripts/release-downloads.ts <version> <build-directory> <empty-download-directory> <current|all>");
   const architectures: ReleaseArchitecture[] = coverage === "all" ? ["x64", "arm64"] : [];
   const names = appDownloadNames(version, coverage === "all" ? architectures : ["x64"], coverage === "all" ? architectures : ["arm64"]);
   await prepareDownloads(directory, destination, names);
   console.log(names.join("\n"));
}
