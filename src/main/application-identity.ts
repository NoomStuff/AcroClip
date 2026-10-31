import { open } from "node:fs/promises";

const known: Record<string, string> = {
   explorer: "Explorer",
   chrome: "Google Chrome",
   msedge: "Microsoft Edge",
   firefox: "Firefox",
   code: "Visual Studio Code",
   discord: "Discord",
   steam: "Steam",
   obs64: "OBS Studio",
};
export function executableLabel(executable: string): string {
   const filename =
      executable
         .replaceAll("\\", "/")
         .split("/")
         .at(-1)
         ?.replace(/\.(exe|app)$/i, "") ?? "Application";
   return known[filename.toLowerCase()] ?? filename.replace(/[_-]+/g, " ").replace(/^\w/, (value) => value.toUpperCase());
}
export function normalizeApplicationLabel(name: string): string {
   const tail = name.split(/\s+[─–—-]\s+/).at(-1) ?? name;
   const normalized = Object.values(known).find((value) => value.toLowerCase() === tail.toLowerCase());
   return normalized ?? (tail === "Windows Explorer" || tail === "File Explorer" ? "Explorer" : name);
}
const names = new Map<string, Promise<string>>();
export function applicationLabel(executable: string): Promise<string> {
   const key = process.platform === "win32" ? executable.toLowerCase() : executable;
   const cached = names.get(key);
   if (cached) return cached;
   const result = readDescription(executable).catch(() => executableLabel(executable));
   names.set(key, result);
   if (names.size > 128) names.delete(names.keys().next().value!);
   return result;
}
async function readDescription(executable: string): Promise<string> {
   const file = await open(executable, "r");
   const read = async (position: number, length: number) => {
      const bytes = Buffer.alloc(length);
      const result = await file.read(bytes, 0, length, position);
      if (result.bytesRead !== length) throw new Error("Incomplete executable metadata");
      return bytes;
   };
   try {
      const dos = await read(0, 64);
      if (dos.toString("ascii", 0, 2) !== "MZ") return executableLabel(executable);
      const offset = dos.readUInt32LE(60);
      if (offset > 16 * 1024 * 1024) return executableLabel(executable);
      const header = await read(offset, 24);
      if (header.readUInt32LE(0) !== 0x4550) return executableLabel(executable);
      const count = header.readUInt16LE(6),
         optionalSize = header.readUInt16LE(20);
      if (count > 96 || optionalSize > 4096 || optionalSize < 136) return executableLabel(executable);
      const optional = await read(offset + 24, optionalSize);
      const directory = optional.readUInt16LE(0) === 0x20b ? 112 : 96;
      if (optional.length < directory + 24) return executableLabel(executable);
      const address = optional.readUInt32LE(directory + 16),
         size = optional.readUInt32LE(directory + 20);
      if (!address || !size || size > 4 * 1024 * 1024) return executableLabel(executable);
      const sections = await read(offset + 24 + optionalSize, count * 40);
      for (let i = 0; i < count; i++) {
         const at = i * 40,
            virtual = sections.readUInt32LE(at + 12),
            length = sections.readUInt32LE(at + 16);
         if (address < virtual || address - virtual >= length) continue;
         const data = await read(sections.readUInt32LE(at + 20) + address - virtual, Math.min(size, length - (address - virtual)));
         for (const property of ["FileDescription", "ProductName"]) {
            const key = Buffer.from(`${property}\0`, "utf16le");
            let index = data.indexOf(key);
            while (index >= 6) {
               const start = index - 6,
                  total = data.readUInt16LE(start),
                  characters = data.readUInt16LE(start + 2);
               const value = Math.ceil((index + key.length) / 4) * 4;
               if (
                  data.readUInt16LE(start + 4) === 1 &&
                  characters > 1 &&
                  characters < 256 &&
                  start + total <= data.length &&
                  value + characters * 2 <= start + total
               ) {
                  const name = data
                     .toString("utf16le", value, value + characters * 2)
                     .split("\0")[0]
                     ?.trim();
                  if (name) return normalizeApplicationLabel(name);
               }
               index = data.indexOf(key, index + key.length);
            }
         }
      }
      return executableLabel(executable);
   } finally {
      await file.close();
   }
}
