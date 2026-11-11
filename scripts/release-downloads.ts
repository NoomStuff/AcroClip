import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export type ReleaseArchitecture = "x64" | "arm64";
export type SourcePlatform = "windows-x64" | "linux-x64" | "linux-arm64" | "darwin-x64" | "darwin-arm64";
export interface PublishedFile {
   /** The electron-builder output name, which carries the version. */
   source: string;
   /** The versionless public name, stable for releases/latest/download links. */
   name: string;
}

function assertVersion(version: string): void {
   if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Pass a stable release version.");
}

/** Build outputs that verification covers, including the Mac ZIPs each DMG is made from. */
export function appDownloadNames(version: string, linux: readonly ReleaseArchitecture[], mac: readonly ReleaseArchitecture[]): string[] {
   assertVersion(version);
   return [
      `AcroClip-${version}-win-x64-Installer.exe`,
      `AcroClip-${version}-win-x64.exe`,
      ...linux.map((arch) => `AcroClip-${version}-linux-${arch === "x64" ? "x86_64" : arch}.AppImage`),
      ...mac.flatMap((arch) => [`AcroClip-${version}-mac-${arch}.dmg`, `AcroClip-${version}-mac-${arch}.zip`]),
   ];
}

/** App downloads on the release page. The installer blockmap enables differential Windows updates. */
export function publishedDownloads(version: string): PublishedFile[] {
   assertVersion(version);
   return [
      { source: `AcroClip-${version}-win-x64-Installer.exe`, name: "AcroClip-windows-x64-setup.exe" },
      { source: `AcroClip-${version}-win-x64-Installer.exe.blockmap`, name: "AcroClip-windows-x64-setup.exe.blockmap" },
      { source: `AcroClip-${version}-win-x64.exe`, name: "AcroClip-windows-x64-portable.exe" },
      { source: `AcroClip-${version}-linux-x86_64.AppImage`, name: "AcroClip-linux-x64.AppImage" },
      { source: `AcroClip-${version}-linux-arm64.AppImage`, name: "AcroClip-linux-arm64.AppImage" },
      { source: `AcroClip-${version}-mac-x64.dmg`, name: "AcroClip-macos-x64.dmg" },
      { source: `AcroClip-${version}-mac-arm64.dmg`, name: "AcroClip-macos-arm64.dmg" },
   ];
}

export function publishedName(version: string, source: string): string {
   const file = publishedDownloads(version).find((entry) => entry.source === source);
   if (!file) throw new Error(`Not a published app download: ${source}`);
   return file.name;
}

export function publishedSourceName(platform: SourcePlatform): string {
   return `AcroClip-sources-${platform.replace("darwin-", "macos-")}.zip`;
}

// Release uploads use this prepared directory, never a wildcard over build output.
export async function prepareDownloads(directory: string, destination: string, files: readonly PublishedFile[]): Promise<void> {
   const entries = await readdir(directory, { withFileTypes: true });
   for (const file of files) {
      if (!entries.some((entry) => entry.name === file.source && entry.isFile())) throw new Error(`Missing app download: ${file.source}`);
   }
   await mkdir(destination, { recursive: true });
   if ((await readdir(destination)).length) throw new Error("Download destination must be empty.");
   for (const file of files) await copyFile(path.join(directory, file.source), path.join(destination, file.name));
}
