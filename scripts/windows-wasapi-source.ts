import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const wasapiCommit = "ba2f32bdf791005443988a4955e963663e16b1ed";
export const wasapiSourceArchiveSha256 = "9a33756d87ce6831c6ddae8b6ea92c86b6cf61c693c9511a716673ba3a3caa5b";
export const wasapiModulePath = "recorder/obs-plugins/64bit/win-wasapi.dll";
export const wasapiSourceNames = ["enum-wasapi.cpp", "enum-wasapi.hpp", "plugin-main.cpp", "wasapi-notify.cpp", "wasapi-notify.hpp", "win-wasapi.cpp"];
const applicationPaths = [
   "native/windows/wasapi/CMakeLists.txt",
   "native/windows/wasapi/obs-wasapi-health.patch",
   "scripts/windows-wasapi-source.ts",
   "scripts/build-native.ts",
];
const digest = z.string().regex(/^[a-f\d]{64}$/);
const relative = z
   .string()
   .refine(
      (value) => !!value && !value.includes("\\") && !value.split("/").some((part) => !part || part === "." || part === "..") && !/^[/:]|:/.test(value),
      "Unsafe packet path"
   );
const fileSchema = z.object({ path: relative, sha256: digest, size: z.number().int().nonnegative() }).strict();
const identitySchema = z.object({ origin: z.string().min(1), sha256: digest, size: z.number().int().nonnegative() }).strict();
const inputSchema = identitySchema
   .extend({
      kind: z.enum(["obs-source", "generated", "object", "system-sdk", "compiler-runtime", "system-metadata"]),
      file: fileSchema.optional(),
      upstreamPath: relative.optional(),
      sourceTextConversion: z.enum(["none", "CRLF-to-LF"]).optional(),
   })
   .strict();
export const wasapiRecordSchema = z
   .object({
      version: z.literal(1),
      upstreamCommit: z.literal(wasapiCommit),
      module: fileSchema.extend({ path: z.literal(wasapiModulePath) }).strict(),
      moduleOrigin: z.string().min(1),
      obsDll: fileSchema.extend({ path: z.literal("recorder/obs.dll") }).strict(),
      applications: z.array(z.object({ projectPath: relative, file: fileSchema }).strict()).min(4),
      sources: z.array(z.object({ origin: z.string(), upstreamPath: relative, file: fileSchema }).strict()).length(6),
      inputs: z.array(inputSchema).min(1),
      compilerPrograms: z.array(identitySchema).min(5),
      evidence: z.array(fileSchema).min(9),
      obsDefinition: fileSchema,
      importCommand: z.string().min(1),
      systemInputs: z.literal(
         "Microsoft MSVC and Windows SDK headers/import libraries are system toolchain inputs. They are identified by version, path and digest, and are not represented as OBS source."
      ),
   })
   .strict();
export type WasapiRecord = z.infer<typeof wasapiRecordSchema>;
type FileRecord = z.infer<typeof fileSchema>;
type InputRecord = z.infer<typeof inputSchema>;
export const wasapiEvidenceDirectory = ".cache/windows-wasapi-evidence";

export async function wasapiHash(file: string): Promise<string> {
   const hash = createHash("sha256");
   for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
   return hash.digest("hex");
}
async function describe(file: string, name: string): Promise<FileRecord> {
   return { path: name, sha256: await wasapiHash(file), size: (await stat(file)).size };
}
function run(command: string, args: string[], cwd?: string): Buffer {
   const result = spawnSync(command, args, { ...(cwd ? { cwd } : {}), windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
   if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.toString()}\n${result.stdout.toString()}`);
   return result.stdout;
}
export function windowsOrigin(value: string): string {
   return path.win32.normalize(value).toUpperCase();
}
export function tlogReads(bytes: Buffer): string[] {
   const text = bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ? bytes.toString("utf16le") : bytes.toString("utf8");
   return [
      ...new Set(
         text
            .replace(/^\uFEFF/, "")
            .split(/\r?\n/)
            .filter((line) => line && !line.startsWith("^"))
            .map(windowsOrigin)
      ),
   ].sort();
}
export function tlogRoots(bytes: Buffer): string[] {
   const text = bytes.toString("utf16le").replace(/^\uFEFF/, "");
   return [
      ...new Set(
         text
            .split(/\r?\n/)
            .filter((line) => line.startsWith("^"))
            .flatMap((line) => line.slice(1).split("|"))
            .map(windowsOrigin)
      ),
   ].sort();
}
function equalSet(actual: string[], expected: string[], label: string): void {
   if (new Set(actual).size !== actual.length) throw new Error(`${label} contains duplicate identities`);
   if (JSON.stringify([...new Set(actual)].sort()) !== JSON.stringify([...new Set(expected)].sort())) throw new Error(`${label} set differs`);
}
function packetFile(directory: string, relativePath: string): string {
   relative.parse(relativePath);
   return path.join(directory, ...relativePath.split("/"));
}
async function checkFile(directory: string, file: FileRecord): Promise<Buffer> {
   const absolute = packetFile(directory, file.path);
   const metadata = await lstat(absolute);
   if (!(await realpath(absolute)).startsWith(`${await realpath(directory)}${path.sep}`)) throw new Error("WASAPI evidence path escapes its packet");
   if (!metadata.isFile() || metadata.size !== file.size || (await wasapiHash(absolute)) !== file.sha256)
      throw new Error(`WASAPI evidence changed: ${file.path}`);
   return readFile(absolute);
}
export function wasapiPacketFiles(record: WasapiRecord): FileRecord[] {
   return [
      ...record.applications.map((item) => item.file),
      ...record.sources.map((item) => item.file),
      ...record.inputs.flatMap((item) => (item.file ? [item.file] : [])),
      ...record.evidence,
      record.obsDefinition,
   ];
}

// Parse the actual PE export table, so obs.def is checked independently of the
// captured dumpbin text and the build's own claims about its import library.
export function peExportNames(bytes: Buffer): string[] {
   const pe = bytes.readUInt32LE(0x3c);
   if (bytes.toString("ascii", pe, pe + 4) !== "PE\0\0") throw new Error("OBS binary has no PE header");
   const optional = pe + 24;
   const magic = bytes.readUInt16LE(optional);
   if (![0x10b, 0x20b].includes(magic)) throw new Error("Unknown PE optional header");
   const sections = optional + bytes.readUInt16LE(pe + 20);
   const count = bytes.readUInt16LE(pe + 6);
   const offset = (rva: number): number => {
      for (let i = 0; i < count; i++) {
         const section = sections + i * 40;
         const start = bytes.readUInt32LE(section + 12);
         const size = Math.max(bytes.readUInt32LE(section + 8), bytes.readUInt32LE(section + 16));
         if (rva >= start && rva - start < size) return bytes.readUInt32LE(section + 20) + rva - start;
      }
      throw new Error("PE export address is outside its sections");
   };
   const table = offset(bytes.readUInt32LE(optional + (magic === 0x20b ? 112 : 96)));
   const names = offset(bytes.readUInt32LE(table + 32));
   const result: string[] = [];
   for (let i = 0; i < bytes.readUInt32LE(table + 24); i++) {
      const start = offset(bytes.readUInt32LE(names + i * 4));
      const end = bytes.indexOf(0, start);
      if (end < start) throw new Error("PE export name is incomplete");
      result.push(bytes.toString("ascii", start, end));
   }
   return result.sort();
}

export async function buildWindowsWasapi(options: {
   project: string;
   upstream: string;
   generated: string;
   tools: string;
   generator: string;
   obsDll: string;
}): Promise<{ binary: string; record: WasapiRecord }> {
   if (process.platform !== "win32") throw new Error("Build the WASAPI module on Windows");
   const { project, upstream, generated, tools, generator, obsDll } = options;
   const work = path.join(project, ".cache/windows-wasapi-build");
   const packet = path.join(project, wasapiEvidenceDirectory);
   // Both destinations are fixed owned cache directories, never runtime or an
   // arbitrary caller-provided deletion path.
   for (const directory of [work, packet]) {
      if (!path.resolve(directory).startsWith(`${path.resolve(project, ".cache")}${path.sep}`)) throw new Error("Unexpected WASAPI build directory");
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
   }
   const canonical = path.join(work, "source");
   await mkdir(path.join(canonical, "plugins/win-wasapi"), { recursive: true });
   for (const name of wasapiSourceNames)
      await writeFile(path.join(canonical, "plugins/win-wasapi", name), run("git", ["-C", upstream, "show", `${wasapiCommit}:plugins/win-wasapi/${name}`]));
   run("git", ["init", "--quiet", canonical]);
   const patch = path.join(project, applicationPaths[1]!);
   const applied = spawnSync("git", ["-c", "core.autocrlf=false", "-C", canonical, "apply", "--verbose", patch], { encoding: "utf8", windowsHide: true });
   if (applied.status !== 0 || /offset|fuzz/i.test(applied.stderr)) throw new Error(`Exact WASAPI patch replay failed: ${applied.stderr}`);
   const output = path.join(work, "build");
   await writeFile(
      path.join(work, "configure.log"),
      run("cmake", [
         "-S",
         path.join(project, "native/windows/wasapi"),
         "-B",
         output,
         "-G",
         generator,
         "-A",
         "x64",
         `-DOBS_SOURCE_DIR=${upstream}`,
         `-DOBS_GENERATED_DIR=${generated}`,
         `-DOBS_IMPORT_LIBRARY=${path.join(generated, "obs.lib")}`,
         `-DWASAPI_SOURCE_DIR=${path.join(canonical, "plugins/win-wasapi")}`,
      ])
   );
   await writeFile(path.join(work, "build.log"), run("cmake", ["--build", output, "--config", "Release"]));
   const binary = path.join(output, "Release/win-wasapi.dll");
   const copy = async (source: string, target: string): Promise<FileRecord> => {
      const destination = packetFile(packet, target);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      return describe(destination, target);
   };
   const applications = await Promise.all(
      applicationPaths.map(async (projectPath) => ({
         projectPath,
         file: await copy(path.join(project, projectPath), `controlled-wasapi/application/${projectPath}`),
      }))
   );
   const sources = await Promise.all(
      wasapiSourceNames.map(async (name) => {
         const origin = path.join(canonical, "plugins/win-wasapi", name);
         return { origin: windowsOrigin(origin), upstreamPath: `plugins/win-wasapi/${name}`, file: await copy(origin, `controlled-wasapi/source/${name}`) };
      })
   );
   const tlogs = path.join(output, "win-wasapi.dir/Release/win-wasapi.tlog");
   const evidence: FileRecord[] = [];
   for (const name of ["CL.command.1.tlog", "CL.read.1.tlog", "CL.write.1.tlog", "link.command.1.tlog", "link.read.1.tlog", "link.write.1.tlog"])
      evidence.push(await copy(path.join(tlogs, name), `controlled-wasapi/build/${name}`));
   evidence.push(await copy(path.join(output, "CMakeCache.txt"), "controlled-wasapi/build/CMakeCache.txt"));
   const cmakeVersion = (await readdir(path.join(output, "CMakeFiles"))).find((name) => /^\d+\.\d+/.test(name));
   if (!cmakeVersion) throw new Error("CMake compiler evidence is absent");
   evidence.push(await copy(path.join(output, "CMakeFiles", cmakeVersion, "CMakeCXXCompiler.cmake"), "controlled-wasapi/build/CMakeCXXCompiler.cmake"));
   evidence.push(await copy(path.join(work, "build.log"), "controlled-wasapi/build/build.log"));
   const consumed = [
      ...new Set([...tlogReads(await readFile(path.join(tlogs, "CL.read.1.tlog"))), ...tlogReads(await readFile(path.join(tlogs, "link.read.1.tlog")))]),
   ].sort();
   const inputs: InputRecord[] = [];
   const upstreamNames = new Map(
      run("git", ["-C", upstream, "ls-tree", "-r", "--name-only", wasapiCommit])
         .toString("utf8")
         .trim()
         .split(/\r?\n/)
         .map((name) => [name.toLowerCase(), name])
   );
   for (const origin of consumed) {
      const base = { origin, sha256: await wasapiHash(origin), size: (await stat(origin)).size };
      if (origin.startsWith(`${windowsOrigin(upstream)}\\`)) {
         const upstreamPath = upstreamNames.get(path.win32.relative(upstream, origin).replaceAll("\\", "/").toLowerCase());
         if (!upstreamPath) throw new Error(`Consumed OBS input is absent from the pinned tree: ${origin}`);
         const canonicalBytes = run("git", ["-C", upstream, "show", `${wasapiCommit}:${upstreamPath}`]);
         const actual = await readFile(origin);
         if (!Buffer.from(actual.toString("utf8").replaceAll("\r\n", "\n")).equals(canonicalBytes))
            throw new Error(`Consumed OBS header differs from the pinned source: ${origin}`);
         inputs.push({
            ...base,
            kind: "obs-source",
            upstreamPath,
            sourceTextConversion: actual.equals(canonicalBytes) ? "none" : "CRLF-to-LF",
            file: await copy(origin, `controlled-wasapi/upstream/${upstreamPath}`),
         });
      } else if (origin.startsWith(`${windowsOrigin(generated)}\\`))
         inputs.push({ ...base, kind: "generated", file: await copy(origin, `controlled-wasapi/generated/${path.win32.basename(origin).toLowerCase()}`) });
      else if (origin.startsWith(`${windowsOrigin(output)}\\`) && origin.endsWith(".OBJ"))
         inputs.push({ ...base, kind: "object", file: await copy(origin, `controlled-wasapi/objects/${path.win32.basename(origin).toLowerCase()}`) });
      else if (sources.some((source) => source.origin === origin))
         inputs.push({ ...base, kind: "generated", file: sources.find((source) => source.origin === origin)!.file });
      else if (/\\WINDOWS KITS\\10\\(?:INCLUDE|LIB)\\[^\\]+\\/.test(origin)) inputs.push({ ...base, kind: "system-sdk" });
      else if (/\\VC\\TOOLS\\MSVC\\[^\\]+\\/.test(origin)) inputs.push({ ...base, kind: "compiler-runtime" });
      else if (/^C:\\WINDOWS\\(?:GLOBALIZATION\\SORTING\\SORTDEFAULT\.NLS|SYSTEM32\\TZRES\.DLL)$/.test(origin))
         inputs.push({ ...base, kind: "system-metadata" });
      else throw new Error(`Unclassified WASAPI build input: ${origin}`);
   }
   const compilerPrograms = await Promise.all(
      ["cl.exe", "c1xx.dll", "c2.dll", "link.exe", "lib.exe"].map(async (name) => {
         const origin = path.join(tools, name);
         return { origin: windowsOrigin(origin), sha256: await wasapiHash(origin), size: (await stat(origin)).size };
      })
   );
   const compilerIdentities = path.join(work, "compiler-programs.json");
   await writeFile(compilerIdentities, JSON.stringify(compilerPrograms, null, 2) + "\n");
   evidence.push(await copy(compilerIdentities, "controlled-wasapi/build/compiler-programs.json"));
   const record = wasapiRecordSchema.parse({
      version: 1,
      upstreamCommit: wasapiCommit,
      module: await describe(binary, wasapiModulePath),
      moduleOrigin: windowsOrigin(binary),
      obsDll: await describe(obsDll, "recorder/obs.dll"),
      applications,
      sources,
      inputs,
      compilerPrograms,
      evidence,
      obsDefinition: await copy(path.join(generated, "obs.def"), "controlled-wasapi/generated/obs.def"),
      importCommand: `${windowsOrigin(path.join(tools, "lib.exe"))} /def:${windowsOrigin(path.join(generated, "obs.def"))} /out:${windowsOrigin(path.join(generated, "obs.lib"))} /machine:x64`,
      systemInputs:
         "Microsoft MSVC and Windows SDK headers/import libraries are system toolchain inputs. They are identified by version, path and digest, and are not represented as OBS source.",
   });
   await writeFile(path.join(packet, "record.json"), JSON.stringify(record, null, 2) + "\n");
   return { binary, record };
}

export async function collectWasapiPacket(project: string, destination: string, record: WasapiRecord): Promise<void> {
   const source = path.join(project, wasapiEvidenceDirectory);
   for (const file of wasapiPacketFiles(record)) {
      await checkFile(source, file);
      const target = packetFile(destination, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(packetFile(source, file.path), target);
   }
}

export async function validateWasapiBuildEvidence(unknownRecord: unknown, directory: string, project: string, staged: FileRecord[]): Promise<WasapiRecord> {
   const record = wasapiRecordSchema.parse(unknownRecord);
   const actualModule = staged.find((item) => item.path === wasapiModulePath);
   const actualObs = staged.find((item) => item.path === "recorder/obs.dll");
   if (
      !actualModule ||
      actualModule.sha256 !== record.module.sha256 ||
      actualModule.size !== record.module.size ||
      !actualObs ||
      actualObs.sha256 !== record.obsDll.sha256 ||
      actualObs.size !== record.obsDll.size
   )
      throw new Error("WASAPI module or linked OBS runtime differs from the actual staged bytes");
   equalSet(
      record.applications.map((item) => item.projectPath),
      applicationPaths,
      "WASAPI application inputs"
   );
   const files = new Map<string, FileRecord>();
   for (const file of wasapiPacketFiles(record)) {
      const previous = files.get(file.path);
      if (previous && (previous.sha256 !== file.sha256 || previous.size !== file.size)) throw new Error("Conflicting WASAPI evidence paths");
      files.set(file.path, file);
      await checkFile(directory, file);
   }
   for (const item of record.applications)
      if (!Buffer.from(await readFile(path.join(project, item.projectPath))).equals(await checkFile(directory, item.file)))
         throw new Error(`WASAPI application recipe changed: ${item.projectPath}`);
   equalSet(
      record.sources.map((item) => item.upstreamPath),
      wasapiSourceNames.map((name) => `plugins/win-wasapi/${name}`),
      "Canonical WASAPI sources"
   );
   const names = [
      "CL.command.1.tlog",
      "CL.read.1.tlog",
      "CL.write.1.tlog",
      "link.command.1.tlog",
      "link.read.1.tlog",
      "link.write.1.tlog",
      "CMakeCache.txt",
      "CMakeCXXCompiler.cmake",
      "build.log",
      "compiler-programs.json",
   ];
   equalSet(
      record.evidence.map((item) => path.posix.basename(item.path)),
      names,
      "WASAPI build evidence"
   );
   const trace = async (name: string): Promise<Buffer> =>
      checkFile(
         directory,
         record.evidence.find((item) => path.posix.basename(item.path) === name)!
      );
   const compileRead = tlogReads(await trace("CL.read.1.tlog"));
   const linkRead = tlogReads(await trace("link.read.1.tlog"));
   equalSet(
      record.inputs.map((item) => item.origin),
      [...compileRead, ...linkRead],
      "WASAPI consumed inputs"
   );
   equalSet(
      tlogRoots(await trace("CL.command.1.tlog")),
      record.sources.filter((item) => item.upstreamPath.endsWith(".cpp")).map((item) => item.origin),
      "WASAPI compiler source roots"
   );
   const compiledObjects = tlogReads(await trace("CL.write.1.tlog")).filter((item) => item.endsWith(".OBJ"));
   equalSet(
      compiledObjects,
      record.inputs.filter((item) => item.kind === "object").map((item) => item.origin),
      "WASAPI compiled objects"
   );
   equalSet(tlogRoots(await trace("link.command.1.tlog")), compiledObjects, "WASAPI link object roots");
   if (!tlogReads(await trace("link.write.1.tlog")).includes(record.moduleOrigin)) throw new Error("WASAPI linker did not write the staged module path");
   const definitions = (await trace("CL.command.1.tlog")).toString("utf16le");
   if (/ATTACLIP_WASAPI_(?:TEST|FAULT)/i.test(definitions)) throw new Error("Diagnostic flags in the production WASAPI command");
   for (const source of record.sources) {
      const input = record.inputs.find((item) => item.origin === source.origin);
      if (source.upstreamPath.endsWith(".hpp") && (!input || input.sha256 !== source.file.sha256 || input.size !== source.file.size))
         throw new Error("WASAPI consumed module header differs from source evidence");
   }
   for (const input of record.inputs) {
      if (input.file && (input.file.sha256 !== input.sha256 || input.file.size !== input.size))
         throw new Error("WASAPI consumed input identity differs from its packet bytes");
      if (["obs-source", "object", "generated"].includes(input.kind) && !input.file) throw new Error("WASAPI non-system input has no packet bytes");
      if (["system-sdk", "compiler-runtime", "system-metadata"].includes(input.kind) && input.file)
         throw new Error("WASAPI proprietary system input must remain an identity record");
      if (input.kind === "obs-source" && (!input.upstreamPath || !compileRead.includes(input.origin)))
         throw new Error("WASAPI upstream header has no compile-read identity");
      if (input.kind === "obs-source" && !input.sourceTextConversion) throw new Error("WASAPI upstream header has no explicit text conversion record");
      if (input.kind === "system-sdk" && !/\\WINDOWS KITS\\10\\(?:INCLUDE|LIB)\\[^\\]+\\/.test(input.origin))
         throw new Error("WASAPI SDK input has an invalid owner path");
      if (input.kind === "compiler-runtime" && !/\\VC\\TOOLS\\MSVC\\[^\\]+\\/.test(input.origin))
         throw new Error("WASAPI compiler input has an invalid owner path");
      if (input.kind === "system-metadata" && !/^C:\\WINDOWS\\(?:GLOBALIZATION\\SORTING\\SORTDEFAULT\.NLS|SYSTEM32\\TZRES\.DLL)$/.test(input.origin))
         throw new Error("WASAPI metadata input has an invalid owner path");
   }
   equalSet(
      record.compilerPrograms.map((item) => path.win32.basename(item.origin)),
      ["CL.EXE", "C1XX.DLL", "C2.DLL", "LINK.EXE", "LIB.EXE"],
      "WASAPI compiler programs"
   );
   const compilerConfiguration = (await trace("CMakeCXXCompiler.cmake")).toString("utf8");
   if (JSON.stringify(JSON.parse((await trace("compiler-programs.json")).toString("utf8"))) !== JSON.stringify(record.compilerPrograms))
      throw new Error("WASAPI compiler program identities differ from captured evidence");
   const compiler = record.compilerPrograms.find((item) => item.origin.endsWith("\\CL.EXE"))!;
   if (!windowsOrigin(compilerConfiguration).includes(compiler.origin)) throw new Error("WASAPI configured compiler differs from its tool identity");
   const generated = record.inputs.filter((item) => item.kind === "generated" && !record.sources.some((source) => source.origin === item.origin));
   equalSet(
      generated.map((item) => path.posix.basename(item.file!.path)),
      ["obs.lib", "obsconfig.h"],
      "WASAPI generated OBS inputs"
   );
   if (!linkRead.includes(generated.find((item) => item.file!.path.endsWith("/obs.lib"))!.origin))
      throw new Error("WASAPI import library is absent from the actual link trace");
   const importOrigin = generated.find((item) => item.file!.path.endsWith("/obs.lib"))!.origin;
   const definitionOrigin = windowsOrigin(path.win32.join(path.win32.dirname(importOrigin), "obs.def"));
   const librarian = record.compilerPrograms.find((item) => item.origin.endsWith("\\LIB.EXE"))!;
   if (record.importCommand !== `${librarian.origin} /def:${definitionOrigin} /out:${importOrigin} /machine:x64`)
      throw new Error("WASAPI OBS import generation command differs from its consumed library");
   const def = (await checkFile(directory, record.obsDefinition)).toString("utf8").trim().split(/\r?\n/);
   if (def.shift() !== "LIBRARY obs" || def.shift() !== "EXPORTS") throw new Error("WASAPI OBS import definition is invalid");
   equalSet(def, peExportNames(await readFile(path.join(project, "resources/recorder/obs.dll"))), "WASAPI OBS import exports");
   const cache = (await trace("CMakeCache.txt")).toString("utf8");
   if (!cache.includes("CMAKE_GENERATOR_PLATFORM:INTERNAL=x64") || !cache.includes("CMAKE_PROJECT_NAME:STATIC=attaclip_wasapi_health"))
      throw new Error("Unexpected WASAPI build configuration");
   return record;
}

export async function validateWasapiPacket(
   unknownRecord: unknown,
   directory: string,
   project: string,
   upstreamArchive: FileRecord,
   staged: FileRecord[]
): Promise<WasapiRecord> {
   const record = await validateWasapiBuildEvidence(unknownRecord, directory, project, staged);
   if (upstreamArchive.sha256 !== wasapiSourceArchiveSha256) throw new Error("WASAPI canonical OBS source archive digest differs from the pinned archive");
   await checkFile(directory, upstreamArchive);
   const members = run("tar", ["-tzf", packetFile(directory, upstreamArchive.path)])
      .toString()
      .trim()
      .split(/\r?\n/);
   const prefix = `obs-studio-${wasapiCommit}/`;
   await replayWasapiSources(record, directory, project, (name) => {
      if (!members.includes(prefix + name)) throw new Error(`Missing canonical OBS WASAPI input: ${name}`);
      return run("tar", ["-xOzf", packetFile(directory, upstreamArchive.path), prefix + name]);
   });
   return record;
}

export async function replayWasapiSources(record: WasapiRecord, directory: string, project: string, readCanonical: (name: string) => Buffer): Promise<void> {
   const scratch = await mkdtemp(path.join(project, ".cache/wasapi-source-check-"));
   try {
      run("git", ["init", "--quiet", scratch]);
      for (const source of record.sources) {
         const target = path.join(scratch, source.upstreamPath);
         await mkdir(path.dirname(target), { recursive: true });
         await writeFile(target, readCanonical(source.upstreamPath));
      }
      const patch = record.applications.find((item) => item.projectPath.endsWith(".patch"))!.file;
      const applied = spawnSync("git", ["-c", "core.autocrlf=false", "-C", scratch, "apply", "--verbose", packetFile(directory, patch.path)], {
         encoding: "utf8",
         windowsHide: true,
      });
      if (applied.status !== 0 || /offset|fuzz/i.test(applied.stderr)) throw new Error(`Canonical WASAPI patch replay failed: ${applied.stderr}`);
      for (const source of record.sources)
         if (!(await readFile(path.join(scratch, source.upstreamPath))).equals(await checkFile(directory, source.file)))
            throw new Error(`WASAPI compiled source differs from canonical patch replay: ${source.upstreamPath}`);
      for (const input of record.inputs.filter((item) => item.kind === "obs-source")) {
         const actual = await checkFile(directory, input.file!);
         if (!Buffer.from(actual.toString("utf8")).equals(actual)) throw new Error("WASAPI upstream header is not UTF-8 text");
         const expected = input.sourceTextConversion === "CRLF-to-LF" ? Buffer.from(actual.toString("utf8").replaceAll("\r\n", "\n")) : actual;
         if (!expected.equals(readCanonical(input.upstreamPath!)))
            throw new Error(`WASAPI consumed OBS header differs from canonical source: ${input.upstreamPath}`);
      }
   } finally {
      await rm(scratch, { recursive: true, force: true });
   }
}

export function exactWasapiException(file: FileRecord, record: WasapiRecord | undefined): boolean {
   return (
      !!record && file.path === wasapiModulePath && file.path === record.module.path && file.sha256 === record.module.sha256 && file.size === record.module.size
   );
}
