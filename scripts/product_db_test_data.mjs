import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const productDbPath = process.env.PRODUCT_DB || join(root, "data", "product.db");
const payloadCache = new Map();

export async function readProductJson(relativePath) {
  const match = String(relativePath).match(/^data\/([a-z0-9-]+)\.json$/i);
  if (!match) return JSON.parse(await readFile(join(root, relativePath), "utf8"));
  if (payloadCache.has(match[1])) return payloadCache.get(match[1]);

  const payload = execFileSync(
    "sqlite3",
    ["-readonly", "-cmd", ".timeout 10000", productDbPath, `select payload_json from datasets where name = '${match[1]}'`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();

  if (!payload) throw new Error(`Missing product dataset in DB: ${match[1]}`);
  const parsed = JSON.parse(payload);
  payloadCache.set(match[1], parsed);
  return parsed;
}
