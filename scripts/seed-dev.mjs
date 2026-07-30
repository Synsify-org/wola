import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL is required"); process.exit(1); }

const file = path.resolve(import.meta.dirname, "seed-dev.sql");
const sql = postgres(url, { max: 1 });
try {
  const body = await readFile(file, "utf8");
  await sql.unsafe(body);
  console.log("seed-dev.sql applied");
} catch (err) {
  console.error("seed-dev failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
