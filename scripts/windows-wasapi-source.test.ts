import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
   exactWasapiException,
   replayWasapiSources,
   validateWasapiBuildEvidence,
   validateWasapiPacket,
   wasapiCommit,
   wasapiModulePath,
   wasapiPacketFiles,
   wasapiSourceNames,
   type WasapiRecord,
} from "./windows-wasapi-source";
import { selectSourceKitFiles } from "./package-source-kit";
import { releaseInventory, validateKit, type SourceKit } from "./release-sources";

const temporary: string[] = [];
afterEach(async () => {
   for (const folder of temporary.splice(0)) await rm(folder, { recursive: true, force: true });
});
const sha = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
type FileRecord = WasapiRecord["module"] extends infer T ? Omit<T, "path"> & { path: string } : never;

function obsPe(): Buffer {
   const bytes = Buffer.alloc(2048);
   bytes.writeUInt32LE(0x80, 0x3c);
   bytes.write("PE\0\0", 0x80, "ascii");
   bytes.writeUInt16LE(1, 0x86);
   bytes.writeUInt16LE(0xf0, 0x94);
   bytes.writeUInt16LE(0x20b, 0x98);
   bytes.writeUInt32LE(0x1000, 0x98 + 112);
   const section = 0x188;
   bytes.writeUInt32LE(512, section + 8);
   bytes.writeUInt32LE(0x1000, section + 12);
   bytes.writeUInt32LE(512, section + 16);
   bytes.writeUInt32LE(0x200, section + 20);
   bytes.writeUInt32LE(1, 0x200 + 24);
   bytes.writeUInt32LE(0x1040, 0x200 + 32);
   bytes.writeUInt32LE(0x1050, 0x240);
   bytes.write("obs_example\0", 0x250, "ascii");
   return bytes;
}

async function fixture(): Promise<{ project: string; packet: string; record: WasapiRecord; staged: FileRecord[]; canonical: Map<string, Buffer> }> {
   const project = await mkdtemp(path.join(os.tmpdir(), "attaclip-wasapi-source-"));
   temporary.push(project);
   const packet = path.join(project, "packet");
   await mkdir(path.join(project, ".cache"));
   const file = async (name: string, data: string | Buffer): Promise<FileRecord> => {
      const bytes = Buffer.from(data);
      await mkdir(path.dirname(path.join(packet, name)), { recursive: true });
      await writeFile(path.join(packet, name), bytes);
      return { path: name, size: bytes.length, sha256: sha(bytes) };
   };
   const canonical = new Map<string, Buffer>();
   const sources: WasapiRecord["sources"] = [];
   for (const name of wasapiSourceNames) {
      const bytes = Buffer.from(`// ${name}\nint value = 1;\n`);
      canonical.set(`plugins/win-wasapi/${name}`, bytes);
      sources.push({
         origin: `D:\\SOURCE\\${name.toUpperCase()}`,
         upstreamPath: `plugins/win-wasapi/${name}`,
         file: await file(`controlled-wasapi/source/${name}`, name === "win-wasapi.cpp" ? bytes.toString().replace("= 1", "= 2") : bytes),
      });
   }
   const patch =
      "--- a/plugins/win-wasapi/win-wasapi.cpp\n+++ b/plugins/win-wasapi/win-wasapi.cpp\n@@ -1,2 +1,2 @@\n // win-wasapi.cpp\n-int value = 1;\n+int value = 2;\n";
   const applications: WasapiRecord["applications"] = [];
   for (const projectPath of [
      "native/windows/wasapi/CMakeLists.txt",
      "native/windows/wasapi/obs-wasapi-health.patch",
      "scripts/windows-wasapi-source.ts",
      "scripts/build-native.ts",
   ]) {
      const bytes = projectPath.endsWith(".patch") ? patch : "fixture application input\n";
      await mkdir(path.dirname(path.join(project, projectPath)), { recursive: true });
      await writeFile(path.join(project, projectPath), bytes);
      applications.push({ projectPath, file: await file(`controlled-wasapi/application/${projectPath}`, bytes) });
   }
   const inputs: WasapiRecord["inputs"] = [];
   const input = async (origin: string, kind: WasapiRecord["inputs"][number]["kind"], name: string, bytes: string, upstreamPath?: string): Promise<void> => {
      const item = await file(name, bytes);
      inputs.push({
         origin,
         kind,
         sha256: item.sha256,
         size: item.size,
         file: item,
         ...(upstreamPath ? { upstreamPath, sourceTextConversion: "CRLF-to-LF" as const } : {}),
      });
   };
   for (const source of sources.filter((item) => item.upstreamPath.endsWith(".hpp")))
      inputs.push({ origin: source.origin, kind: "generated", sha256: source.file.sha256, size: source.file.size, file: source.file });
   await input("D:\\OBS\\LIBOBS\\OBS.H", "obs-source", "controlled-wasapi/upstream/libobs/obs.h", "// OBS header\r\n", "libobs/obs.h");
   canonical.set("libobs/obs.h", Buffer.from("// OBS header\n"));
   await input("D:\\GENERATED\\OBSCONFIG.H", "generated", "controlled-wasapi/generated/obsconfig.h", "// config\n");
   await input("D:\\GENERATED\\OBS.LIB", "generated", "controlled-wasapi/generated/obs.lib", "OBS import library");
   for (const source of sources.filter((item) => item.upstreamPath.endsWith(".cpp")))
      await input(
         `D:\\BUILD\\${path.posix.basename(source.upstreamPath).toUpperCase().replace(".CPP", ".OBJ")}`,
         "object",
         `controlled-wasapi/objects/${path.posix.basename(source.upstreamPath).replace(".cpp", ".obj")}`,
         "actual fixture object"
      );
   inputs.push({
      origin: "C:\\PROGRAM FILES (X86)\\WINDOWS KITS\\10\\LIB\\10.0.19041.0\\UM\\X64\\KERNEL32.LIB",
      kind: "system-sdk",
      sha256: sha("SDK identity"),
      size: 12,
   });
   const compilerBase = "C:\\VS\\VC\\TOOLS\\MSVC\\14.29.30133\\BIN\\HOSTX64\\X64";
   const compilerPrograms = ["CL.EXE", "C1XX.DLL", "C2.DLL", "LINK.EXE", "LIB.EXE"].map((name) => ({
      origin: compilerBase + "\\" + name,
      sha256: sha(name),
      size: name.length,
   }));
   const compileOrigins = sources.filter((item) => item.upstreamPath.endsWith(".cpp")).map((item) => item.origin);
   const headers = inputs
      .filter((item) => item.kind === "obs-source" || item.file?.path.endsWith(".hpp") || item.file?.path.endsWith("obsconfig.h"))
      .map((item) => item.origin);
   const objectOrigins = inputs.filter((item) => item.kind === "object").map((item) => item.origin);
   const linkOrigins = inputs.filter((item) => item.kind === "object" || item.origin.endsWith(".LIB")).map((item) => item.origin);
   const moduleOrigin = "D:\\BUILD\\RELEASE\\WIN-WASAPI.DLL";
   const traces: Record<string, string> = {
      "CL.command.1.tlog": compileOrigins.map((origin) => `^${origin}\n/c /D NOMINMAX /diagnostics:column ${origin}`).join("\n"),
      "CL.read.1.tlog": `^${compileOrigins[0]}\n${headers.join("\n")}`,
      "CL.write.1.tlog": `^${compileOrigins[0]}\n${objectOrigins.join("\n")}`,
      "link.command.1.tlog": `^${objectOrigins.join("|")}\n/DLL /OUT:${moduleOrigin}`,
      "link.read.1.tlog": `^${objectOrigins.join("|")}\n${linkOrigins.join("\n")}`,
      "link.write.1.tlog": `^${objectOrigins.join("|")}\n${moduleOrigin}`,
   };
   const evidence: FileRecord[] = [];
   for (const [name, text] of Object.entries(traces)) evidence.push(await file(`controlled-wasapi/build/${name}`, Buffer.from("\uFEFF" + text, "utf16le")));
   evidence.push(
      await file("controlled-wasapi/build/CMakeCache.txt", "CMAKE_GENERATOR_PLATFORM:INTERNAL=x64\nCMAKE_PROJECT_NAME:STATIC=attaclip_wasapi_health\n")
   );
   evidence.push(
      await file("controlled-wasapi/build/CMakeCXXCompiler.cmake", `set(CMAKE_CXX_COMPILER "${compilerPrograms[0]!.origin.replaceAll("\\", "/")}")\n`)
   );
   evidence.push(await file("controlled-wasapi/build/build.log", "actual fixture build"));
   evidence.push(await file("controlled-wasapi/build/compiler-programs.json", JSON.stringify(compilerPrograms)));
   const pe = obsPe();
   await mkdir(path.join(project, "resources/recorder"), { recursive: true });
   await writeFile(path.join(project, "resources/recorder/obs.dll"), pe);
   const record: WasapiRecord = {
      version: 1,
      upstreamCommit: wasapiCommit,
      module: { path: wasapiModulePath, size: 6, sha256: sha("module") },
      moduleOrigin,
      obsDll: { path: "recorder/obs.dll", size: pe.length, sha256: sha(pe) },
      applications,
      sources,
      inputs,
      compilerPrograms,
      evidence,
      obsDefinition: await file("controlled-wasapi/generated/obs.def", "LIBRARY obs\nEXPORTS\nobs_example\n"),
      importCommand: `${compilerBase}\\LIB.EXE /def:D:\\GENERATED\\OBS.DEF /out:D:\\GENERATED\\OBS.LIB /machine:x64`,
      systemInputs:
         "Microsoft MSVC and Windows SDK headers/import libraries are system toolchain inputs. They are identified by version, path and digest, and are not represented as OBS source.",
   };
   return { project, packet, record, staged: [record.module, record.obsDll], canonical };
}

describe("controlled WASAPI source boundaries", () => {
   it("validates exact compiler/read/link evidence without bundling system SDK files", async () => {
      const f = await fixture();
      expect(await validateWasapiBuildEvidence(f.record, f.packet, f.project, f.staged)).toEqual(f.record);
      expect(wasapiPacketFiles(f.record).some((item) => /KERNEL32|C1XX/i.test(item.path))).toBe(false);
   });
   it("replays the patch and permits only explicit CRLF-to-LF upstream header conversion", async () => {
      const f = await fixture();
      await replayWasapiSources(f.record, f.packet, f.project, (name) => f.canonical.get(name)!);
      f.canonical.set("libobs/obs.h", Buffer.from("// changed OBS header\n"));
      await expect(replayWasapiSources(f.record, f.packet, f.project, (name) => f.canonical.get(name)!)).rejects.toThrow("consumed OBS header differs");
   });
   it("rejects source bytes that no longer equal canonical exact patch replay", async () => {
      const f = await fixture();
      const target = f.record.sources.find((item) => item.upstreamPath.endsWith("win-wasapi.cpp"))!.file;
      const bytes = Buffer.from("int unrelated = 3;\n");
      await writeFile(path.join(f.packet, target.path), bytes);
      target.size = bytes.length;
      target.sha256 = sha(bytes);
      await expect(replayWasapiSources(f.record, f.packet, f.project, (name) => f.canonical.get(name)!)).rejects.toThrow("compiled source differs");
   });
   it("rejects changed module identity and never exempts any unrelated OBS file", async () => {
      const f = await fixture();
      expect(exactWasapiException(f.record.module, f.record)).toBe(true);
      expect(exactWasapiException({ ...f.record.module, path: "recorder/obs-plugins/64bit/win-capture.dll" }, f.record)).toBe(false);
      expect(exactWasapiException({ ...f.record.module, sha256: sha("changed") }, f.record)).toBe(false);
      expect(exactWasapiException(f.record.module, undefined)).toBe(false);
      f.staged = [{ ...f.record.module, sha256: sha("changed") }, f.record.obsDll];
      await expect(validateWasapiBuildEvidence(f.record, f.packet, f.project, f.staged)).rejects.toThrow("staged bytes");
   });
   it.each(["compiler", "header", "link", "source-set", "recipe"])("rejects altered %s evidence", async (mutation) => {
      const f = await fixture();
      if (mutation === "compiler") f.record.compilerPrograms[0]!.sha256 = sha("other compiler");
      if (mutation === "header") f.record.inputs = f.record.inputs.filter((item) => item.kind !== "obs-source");
      if (mutation === "link") f.record.inputs = f.record.inputs.filter((item) => !item.origin.endsWith("OBS.LIB"));
      if (mutation === "source-set") f.record.sources.pop();
      if (mutation === "recipe") await writeFile(path.join(f.project, f.record.applications[0]!.projectPath), "changed recipe");
      await expect(validateWasapiBuildEvidence(f.record, f.packet, f.project, f.staged)).rejects.toThrow();
   });
   it("rejects diagnostic compile macros while accepting ordinary MSVC diagnostics flags", async () => {
      const f = await fixture();
      const command = f.record.evidence.find((item) => item.path.endsWith("CL.command.1.tlog"))!;
      const bytes = Buffer.concat([await readFile(path.join(f.packet, command.path)), Buffer.from("\n/D ATTACLIP_WASAPI_TEST_FAULTS", "utf16le")]);
      await writeFile(path.join(f.packet, command.path), bytes);
      command.size = bytes.length;
      command.sha256 = sha(bytes);
      await expect(validateWasapiBuildEvidence(f.record, f.packet, f.project, f.staged)).rejects.toThrow("Diagnostic flags");
   });
   it("rejects a different canonical archive digest and path escape", async () => {
      const f = await fixture();
      await expect(
         validateWasapiPacket(f.record, f.packet, f.project, { path: "upstream.tar.gz", size: 0, sha256: sha("other archive") }, f.staged)
      ).rejects.toThrow("pinned archive");
      f.record.sources[0]!.file.path = "../escape";
      await expect(validateWasapiBuildEvidence(f.record, f.packet, f.project, f.staged)).rejects.toThrow("Unsafe packet path");
   });
   it("keeps every controlled source and build record when pruning a distributable kit", async () => {
      const f = await fixture();
      const kit: SourceKit = {
         version: 1,
         createdAt: "",
         platform: "win32-x64",
         appCommit: "",
         appDirty: false,
         publicInstallerReady: false,
         staged: [],
         sources: [],
         blockers: [],
         controlledWasapi: f.record,
         evidence: { stagedDigest: "", components: [] },
      };
      expect(
         selectSourceKitFiles(kit)
            .files.map((item) => item.path)
            .sort()
      ).toEqual([...new Set(wasapiPacketFiles(f.record).map((item) => item.path))].sort());
   });
   it("rejects removal of both native and kit module records when the current application requires the controlled recipe", async () => {
      const f = await fixture();
      await writeFile(path.join(f.project, "resources/recorder/provenance.json"), "{}");
      const kit: SourceKit = {
         version: 1,
         createdAt: "",
         platform: "win32-x64",
         appCommit: "",
         appDirty: false,
         publicInstallerReady: false,
         staged: await releaseInventory(f.project),
         sources: [],
         blockers: [],
         requiredEvidence: [],
      };
      expect(await validateKit(kit, f.packet, f.project)).toContain(
         "Controlled WASAPI source validation failed: Controlled WASAPI kit record differs from actual native build provenance"
      );
   });
});
