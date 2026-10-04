import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
for (const app of ["frontend", "backend"]) {
  const dir = new URL(`../apps/${app}/`, import.meta.url);
  const target = new URL(".env", dir);
  if (!existsSync(target)) copyFileSync(fileURLToPath(new URL(".env.example", dir)), fileURLToPath(target));
}
