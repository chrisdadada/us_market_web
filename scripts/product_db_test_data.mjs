import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const productDbPath = process.env.PRODUCT_DB || join(root, "data", "product.db");
const payloadCache = new Map();

export async function readProductDataset(name) {
  const dataset = String(name || "").trim();
  if (!/^[a-z0-9-]+$/i.test(dataset)) throw new Error(`Invalid product dataset name: ${dataset}`);
  if (payloadCache.has(dataset)) return payloadCache.get(dataset);

  const payload = execFileSync(
    "sqlite3",
    ["-cmd", ".timeout 10000", productDbPath, `select payload_json from datasets where name = '${dataset}'`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();

  if (!payload) throw new Error(`Missing product dataset in DB: ${dataset}`);
  const parsed = JSON.parse(payload);
  payloadCache.set(dataset, parsed);
  return parsed;
}
