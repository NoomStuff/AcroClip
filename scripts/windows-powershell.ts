import path from "node:path";

/**
 * Windows PowerShell by its full path. On the 20261116 runner image a bare `powershell` from PATH
 * printed nothing and exited 0, so archives "extracted" empty and version checks read blank.
 */
export const windowsPowerShell = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
