import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { clipboard, ClipboardItem } from "electron";

/** The command that puts one file on the clipboard the way the file manager's Copy does. */
export function clipboardCommand(
   path: string,
   platform: NodeJS.Platform,
   environment: NodeJS.ProcessEnv
): { file: string; args: string[]; env: NodeJS.ProcessEnv } | null {
   if (platform === "win32")
      return {
         // Windows PowerShell 5.1 ships with Windows and writes a file drop list (CF_HDROP).
         // PowerShell 7 dropped Set-Clipboard -LiteralPath, so name the inbox one explicitly.
         file: join(environment["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
         args: ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath $env:ACROCLIP_CLIPBOARD_FILE"],
         // The path travels as data, never as part of the script.
         env: { ...environment, ACROCLIP_CLIPBOARD_FILE: path },
      };
   if (platform === "darwin")
      return {
         file: "osascript",
         args: ["-e", "on run argv", "-e", "set the clipboard to (POSIX file (item 1 of argv))", "-e", "end run", path],
         env: environment,
      };
   return null;
}

export async function copyFileToClipboard(path: string): Promise<void> {
   const command = clipboardCommand(path, process.platform, process.env);
   if (!command) {
      // Browsers and chat apps paste a file from its URI list. GNOME's file
      // manager reads its own copy format. One write publishes both together.
      const uri = pathToFileURL(path).href;
      await clipboard.write([new ClipboardItem({ "text/uri-list": `${uri}\r\n`, "x-special/gnome-copied-files": `copy\n${uri}` })]);
      return;
   }
   await new Promise<void>((resolve, reject) => {
      const child = spawn(command.file, command.args, { env: command.env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => child.kill(), 10_000);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data: string) => (stderr = (stderr + data).slice(-2000)));
      child.once("error", (error) => {
         clearTimeout(timer);
         reject(new Error(`The file couldn't be copied: ${error.message}`));
      });
      child.once("close", (code) => {
         clearTimeout(timer);
         if (code === 0) resolve();
         else reject(new Error(stderr.trim() ? `The file couldn't be copied: ${stderr.trim()}` : "The file couldn't be copied."));
      });
   });
}
