import { readFile, writeFile } from "node:fs/promises";
const source = new URL("../apps/backend/src/protocol/gameProtocol.ts", import.meta.url);
const target = new URL("../apps/frontend/src/types/gameProtocol.ts", import.meta.url);
const content = "// Generated from the backend wire contract. Do not edit directly.\n" + await readFile(source, "utf8");
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8").catch(() => "") !== content) {
    throw new Error("Game protocol differs. Run npm run contracts:sync.");
  }
} else {
  await writeFile(target, content);
}
