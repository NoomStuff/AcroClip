// Copyright (c) 2026 NoomStuff. MIT. Adapted from AttaCut; THIRD_PARTY_NOTICES.md.
import { app } from "electron";
import { spawn } from "node:child_process";

// A branded executable also loads default_app in development. Its filename alone
// makes Electron report isPackaged=true, so retain the actual launch mode.
export function isPackagedApp(): boolean {
   return app.isPackaged && !process.defaultApp;
}

export function windowsAppId(): string {
   // Explorer can use an installed shortcut's icon for every window in a group.
   // Development must not join that group or overwrite its registered identity.
   return isPackagedApp() ? "dev.acroclip.app" : "dev.acroclip.app.development";
}

export function registerWindowsIdentity(icon: string): void {
   if (process.platform !== "win32" || process.env["ACROCLIP_TEST"] === "1") return;
   const write = (key: string, name: string, value: string) =>
      spawn("reg", ["add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
   const key = `HKCU\\Software\\Classes\\AppUserModelId\\${windowsAppId()}`;
   write(key, "DisplayName", "AcroClip");
   write(key, "IconUri", icon);
   write("HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache", `${process.execPath}.FriendlyAppName`, "AcroClip");
}
