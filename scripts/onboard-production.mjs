// scripts/onboard-production.mjs — create (or reset) a platform operator, interactively.
//
//   npm run onboard:operator
//
// Why this exists: doing it with environment variables in PowerShell is easy to get
// wrong (quotes, placeholders, secrets left in shell history and on screen). Here:
//   - the database connection string is typed or pasted at a HIDDEN prompt (shown as *),
//   - it prints the host it is about to use (never the password) and makes you type the
//     host name to confirm, so the wrong database is hard to hit by accident,
//   - the operator's password is generated here and shown ONCE, for your password manager.
// It then runs scripts/onboard-super-admin.mjs with those values for that one process only.
// Running it again for the same email resets that operator's password.
import readline from "node:readline";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

// One input session for all prompts (separate sessions can lose buffered input).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const lines = [];
const waiting = [];
let closed = false;
rl.on("line", (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
rl.on("close", () => { closed = true; while (waiting.length) waiting.shift()(""); });
// While a secret is being typed or pasted, readline echoes it through _writeToOutput.
// Replace every echoed character with "*" (leave cursor/newline control codes alone).
let muted = false;
const echo = rl._writeToOutput?.bind(rl);
if (echo) {
  rl._writeToOutput = (s) => (muted && s && !/^[\x1b\r\n]/.test(s) ? echo("*".repeat(s.length)) : echo(s));
}

async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  muted = hidden;
  const answer = lines.length ? lines.shift() : closed ? "" : await new Promise((res) => waiting.push(res));
  muted = false;
  if (hidden && process.stdin.isTTY) process.stdout.write("\n");
  return answer.trim();
}

const stripQuotes = (s) => s.replace(/^["']+|["']+$/g, "").trim();

console.log("\nCreate or reset a platform operator.\n");

const raw = stripQuotes(await ask("Database admin connection string (hidden): ", { hidden: true }));
let url;
try {
  url = new URL(raw);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("not a postgres URL");
} catch {
  console.error("\nThat is not a valid connection string. It should start with postgresql:// and look like");
  console.error("postgresql://postgres.<ref>:<password, with @ written as %40>@<host>:5432/postgres");
  console.error("Nothing was changed.");
  process.exit(1);
}

const host = url.hostname;
console.log(`\nThis will connect to:  ${decodeURIComponent(url.username)}@${host}:${url.port || 5432}${url.pathname}`);
console.log(`To continue, type this host name exactly (copy it from the line above), then press Enter:
    ${host}
Anything else cancels and changes nothing.`);
const typed = await ask("> ");
if (typed !== host) {
  console.error("Cancelled. Nothing was changed.");
  process.exit(1);
}

const email = (await ask("Operator email: ")).toLowerCase();
const name = await ask("Operator name: ");
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
  console.error("An email and a name are required. Nothing was changed.");
  process.exit(1);
}

const password = randomBytes(18).toString("base64url");
const result = spawnSync(process.execPath, ["--import", "dotenv/config", path.join(import.meta.dirname, "onboard-super-admin.mjs")], {
  stdio: ["ignore", "inherit", "inherit"],
  // Only this child process sees these values. DATABASE_ADMIN_URL set here wins over any .env.
  env: { ...process.env, DATABASE_ADMIN_URL: raw, SUPER_ADMIN_EMAIL: email, SUPER_ADMIN_NAME: name, SUPER_ADMIN_PASSWORD: password },
});
if (result.status !== 0) {
  console.error("\nThe operator was NOT created (see the error above).");
  process.exit(result.status ?? 1);
}

console.log("\n------------------------------------------------------------");
console.log(`Operator:  ${email}`);
console.log(`Password:  ${password}`);
console.log("------------------------------------------------------------");
console.log("Copy the password into your password manager NOW. It is shown once and cannot be recovered");
console.log("(run this again to reset it). Do not paste it into chat or email.");
console.log("Then close this terminal window so the screen history is gone.\n");
