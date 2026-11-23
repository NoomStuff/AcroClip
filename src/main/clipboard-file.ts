import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { clipboard, ClipboardItem } from "electron";

interface ClipboardCommand {
   file: string;
   args: string[];
   env: NodeJS.ProcessEnv;
   /** It prints "copied" once done, which tells it apart from an older helper that ignored the request. */
   confirms?: boolean;
}

/**
 * The command that puts one file on the clipboard the way the file manager's Copy does. On Windows,
 * AcroClip's own feedback helper does it in milliseconds where it ships. PowerShell is the fallback.
 */
export function clipboardCommand(path: string, platform: NodeJS.Platform, environment: NodeJS.ProcessEnv, helper?: string): ClipboardCommand | null {
   if (platform === "win32" && helper)
      // The path travels as data, never as part of the command line.
      return { file: helper, args: ["--copy-file"], env: { ...environment, ACROCLIP_CLIPBOARD_FILE: path }, confirms: true };
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

export async function copyFileToClipboard(path: string, helper?: string): Promise<void> {
   if (helper && process.platform === "win32" && existsSync(helper)) {
      try {
         await runClipboardCommand(clipboardCommand(path, process.platform, process.env, helper)!);
         return;
      } catch {
         /* PowerShell below still copies it, only slower. */
      }
   }
   const command = clipboardCommand(path, process.platform, process.env);
   if (!command) {
      // Browsers and chat apps paste a file from its URI list. GNOME's file
      // manager reads its own copy format. One write publishes both together.
      const uri = pathToFileURL(path).href;
      await clipboard.write([new ClipboardItem({ "text/uri-list": `${uri}\r\n`, "x-special/gnome-copied-files": `copy\n${uri}` })]);
      return;
   }
   await runClipboardCommand(command);
}

function runClipboardCommand(command: ClipboardCommand): Promise<void> {
   return new Promise<void>((resolve, reject) => {
      const child = spawn(command.file, command.args, { env: command.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data: string) => (stdout = (stdout + data).slice(-200)));
      const timer = setTimeout(() => child.kill(), 10_000);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data: string) => (stderr = (stderr + data).slice(-2000)));
      child.once("error", (error) => {
         clearTimeout(timer);
         reject(new Error(`The file couldn't be copied: ${error.message}`));
      });
      child.once("close", (code) => {
         clearTimeout(timer);
         if (code === 0 && (!command.confirms || stdout.includes("copied"))) resolve();
         else reject(new Error(stderr.trim() ? `The file couldn't be copied: ${stderr.trim()}` : "The file couldn't be copied."));
      });
   });
}
