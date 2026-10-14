// scripts/lib/xlsx-lite.mjs: read the first sheet of an .xlsx file as rows of text, with no
// dependency. An .xlsx is a zip of XML files; this reads just enough of it: the zip directory,
// the shared-strings table and the first worksheet's cells. Formulas are read as their last
// computed value. It does not write files, evaluate anything or follow links.
import { inflateRawSync } from "node:zlib";

function unzip(buf) {
  // End-of-central-directory record: scan backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not an .xlsx file (no zip directory found).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt .xlsx (bad zip directory).");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    files.set(name, () => (method === 0 ? raw : method === 8 ? inflateRawSync(raw) : (() => { throw new Error(`Unsupported zip method ${method}.`); })()).toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, "&");
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
const colIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** @returns {{ sheet: string, rows: string[][] }} the first sheet; empty cells are "". */
export function readXlsx(buf) {
  const files = unzip(buf);
  const get = (name) => { const f = files.get(name); if (!f) throw new Error(`Not a spreadsheet this reader understands (missing ${name}).`); return f(); };

  const shared = files.has("xl/sharedStrings.xml")
    ? [...get("xl/sharedStrings.xml").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];

  const book = get("xl/workbook.xml");
  const first = book.match(/<sheet\s[^>]*>/);
  if (!first) throw new Error("The workbook has no sheets.");
  const sheetName = decode((first[0].match(/name="([^"]*)"/) ?? [, "Sheet1"])[1]);
  const rid = (first[0].match(/r:id="([^"]*)"/) ?? [])[1];
  let target = "worksheets/sheet1.xml";
  if (rid && files.has("xl/_rels/workbook.xml.rels")) {
    const rel = [...get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
    const t = rel?.match(/Target="([^"]*)"/)?.[1];
    if (t) target = t.replace(/^\/?(xl\/)?/, "");
  }
  const sheet = get(`xl/${target}`);

  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const rn = Number((rowMatch[0].match(/\sr="(\d+)"/) ?? [])[1] ?? rows.length + 1) - 1;
    const cells = [];
    for (const c of rowMatch[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? "";
      const ref = (attrs.match(/\sr="([A-Z]+\d+)"/) ?? attrs.match(/^r="([A-Z]+\d+)"/) ?? [])[1];
      const type = (attrs.match(/\st="([^"]*)"/) ?? attrs.match(/^t="([^"]*)"/) ?? [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (v !== undefined) value = decode(v);
      if (ref) cells[colIndex(ref)] = value;
    }
    while (rows.length < rn) rows.push([]);
    rows[rn] = Array.from(cells, (x) => x ?? "");
  }
  return { sheet: sheetName, rows };
}
