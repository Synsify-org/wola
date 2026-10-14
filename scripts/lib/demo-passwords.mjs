// scripts/lib/demo-passwords.mjs: new random passwords for a set of accounts, as SQL for the
// Supabase SQL Editor. Pure apart from randomness and hashing, so a test can run the SQL and sign in.
import { randomInt } from "node:crypto";
import argon2 from "argon2";

// No look-alikes (0/O, 1/l/I): these get read aloud and typed in front of an audience.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newPassword = (length = 14) => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** @param {string[]} emails @returns {Promise<{ sql: string, passwords: { email: string, password: string }[] }>} */
export async function passwordSql(emails) {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) throw new Error("No email addresses given.");
  const bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (bad.length) throw new Error(`Not valid email addresses: ${bad.join(", ")}`);

  const passwords = [];
  for (const email of list) passwords.push({ email, password: newPassword() });
  const rows = [];
  for (const p of passwords) rows.push(`(${lit(p.email)}, ${lit(await argon2.hash(p.password, { type: argon2.argon2id }))})`);

  const sql = `-- Wola: set new passwords for ${list.length} account${list.length === 1 ? "" : "s"}. Run once in the Supabase SQL Editor.
-- Also signs those accounts out everywhere, so an old password or an old session stops working at once.
WITH changed AS (
  UPDATE users u SET password_hash = v.h
  FROM (VALUES ${rows.join(",\n    ")}) AS v(email, h)
  WHERE u.email = v.email
  RETURNING u.id, u.email
), signed_out AS (
  DELETE FROM sessions WHERE user_id IN (SELECT id FROM changed) RETURNING 1
)
SELECT email AS updated_account, (SELECT count(*) FROM signed_out) AS sessions_ended FROM changed ORDER BY email;
`;
  return { sql, passwords };
}
