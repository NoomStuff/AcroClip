import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { windowsDevExecutable } from "./windows-dev-identity";

const executable = await windowsDevExecutable(process.cwd());
const child = spawn(process.execPath, [resolve("node_modules/electron-vite/bin/electron-vite.js"), "dev"], {
   stdio: "inherit",
   windowsHide: true,
   env: { ...process.env, ...(executable ? { ELECTRON_EXEC_PATH: executable } : {}) },
});
child.on("error", (error) => {
   console.error(error);
   process.exitCode = 1;
});
child.on("exit", (code) => {
   process.exitCode = code ?? 1;
});
