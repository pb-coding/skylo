import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
for (const app of ["backend", "frontend"]) {
  const cwd = fileURLToPath(new URL(`../apps/${app}/`, import.meta.url));
  const args = app === "backend"
    ? ["node_modules/ts-node/dist/bin.js", "src/server.ts"]
    : ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173", "--strictPort"];
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
  children.push(child);
  child.on("error", error => { console.error(error); stop(1); });
  child.on("exit", code => stop(code ?? 1));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
