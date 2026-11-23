/**
 * A Win32 desktop of our own, separate from the one the person at the computer sees. Windows on it
 * never appear on their screen, take focus, or reach their taskbar and tray, and processes started
 * on it pass it on to their children. Used by agent-app.ts on Windows.
 */
import { dlopen, ptr, type Pointer } from "bun:ffi";

const user32 = dlopen("user32.dll", {
   CreateDesktopW: { args: ["ptr", "ptr", "ptr", "u32", "u32", "ptr"], returns: "ptr" },
   OpenDesktopW: { args: ["ptr", "u32", "i32", "u32"], returns: "ptr" },
   GetThreadDesktop: { args: ["u32"], returns: "ptr" },
   GetUserObjectInformationW: { args: ["ptr", "i32", "ptr", "u32", "ptr"], returns: "i32" },
});
const kernel32 = dlopen("kernel32.dll", {
   CreateProcessW: {
      args: ["ptr", "ptr", "ptr", "ptr", "i32", "u32", "ptr", "ptr", "ptr", "ptr"],
      returns: "i32",
   },
   CloseHandle: { args: ["ptr"], returns: "i32" },
   GetCurrentThreadId: { args: [], returns: "u32" },
   GetLastError: { args: [], returns: "u32" },
});

const GENERIC_ALL = 0x10000000;
const UOI_NAME = 2;
const CREATE_NO_WINDOW = 0x08000000;
const CREATE_NEW_PROCESS_GROUP = 0x00000200;
const CREATE_UNICODE_ENVIRONMENT = 0x00000400;

const wide = (text: string): Buffer => Buffer.from(`${text}\0`, "utf16le");

/** A handle that keeps the desktop alive while it is held. The desktop goes away with its last handle and process. */
export function openDesktop(name: string): Pointer {
   const existing = user32.symbols.OpenDesktopW(ptr(wide(name)), 0, 0, GENERIC_ALL);
   if (existing) return existing;
   const created = user32.symbols.CreateDesktopW(ptr(wide(name)), null, null, 0, GENERIC_ALL, null);
   if (!created) throw new Error(`Couldn't create the ${name} desktop (error ${kernel32.symbols.GetLastError()}).`);
   return created;
}

/** The name of the desktop this thread runs on, "Default" for the person's own. */
export function currentDesktop(): string {
   const desktop = user32.symbols.GetThreadDesktop(kernel32.symbols.GetCurrentThreadId());
   if (!desktop) return "";
   const name = Buffer.alloc(512);
   const length = new Uint32Array(1);
   if (!user32.symbols.GetUserObjectInformationW(desktop, UOI_NAME, ptr(name), name.byteLength, ptr(length))) return "";
   return name.toString("utf16le").split("\0")[0] ?? "";
}

const quote = (argument: string): string => (/^[^\s"]+$/.test(argument) ? argument : `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`);

/** Starts a process without a console on `desktop` and returns its pid. Output goes nowhere, so it should log to a file. */
export function spawnOnDesktop(desktop: string, command: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv): number {
   const startup = Buffer.alloc(104);
   const desktopName = wide(`WinSta0\\${desktop}`);
   startup.writeUInt32LE(startup.byteLength, 0);
   startup.writeBigUInt64LE(BigInt(ptr(desktopName)), 16);
   const information = Buffer.alloc(24);
   const commandLine = wide([command, ...args].map(quote).join(" "));
   const block = wide(
      `${Object.entries(environment)
         .filter((entry): entry is [string, string] => entry[1] !== undefined)
         .map(([key, value]) => `${key}=${value}`)
         .join("\0")}\0`
   );
   const started = kernel32.symbols.CreateProcessW(
      null,
      ptr(commandLine),
      null,
      null,
      0,
      CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT,
      ptr(block),
      ptr(wide(cwd)),
      ptr(startup),
      ptr(information)
   );
   if (!started) throw new Error(`Couldn't start ${command} on the ${desktop} desktop (error ${kernel32.symbols.GetLastError()}).`);
   const handles = [information.readBigUInt64LE(0), information.readBigUInt64LE(8)];
   for (const handle of handles) kernel32.symbols.CloseHandle(Number(handle) as Pointer);
   return information.readUInt32LE(16);
}
