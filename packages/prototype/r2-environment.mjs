import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseEnv } from "node:util";

export const r2Keys = [
  "R2_ACCOUNT_ID", "R2_BUCKET", "R2_PUBLIC_BASE_URL",
  "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
];

export async function loadR2Environment({
  root = fileURLToPath(new URL("../../", import.meta.url)),
  env = process.env,
} = {}) {
  const result = {};
  for (const key of r2Keys) {
    if (env[key] !== undefined) result[key] = env[key];
  }
  for (const name of [".env.local", ".env"]) {
    let values;
    try {
      values = parseEnv(await readFile(join(root, name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error("Unable to read R2 environment configuration");
    }
    for (const key of r2Keys) {
      if (result[key] === undefined && values[key] !== undefined) {
        result[key] = values[key];
      }
    }
  }
  return result;
}
