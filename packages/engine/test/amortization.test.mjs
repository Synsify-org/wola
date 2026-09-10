// packages/engine/test/amortization.test.mjs
// Validates the amortization engine against MUA's actual spreadsheet
// (parity, rounding off) AND production behavior (rounding on, closes at zero).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSchedule, computeInstalment, applyEarlyPayment, ENGINE_VERSION }
  from "../dist/amortization.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ── PARITY: reproduce MUA's "Amortization analysis final" to the decimal ──
test("MUA parity: instalment matches sheet H6 (10M @ 16% / 36mo)", () => {
  const r = 0.16 / 12;
  const inst = computeInstalment(10_000_000, r, 36);
  assert.ok(near(inst, 351570.3303635009), `got ${inst}`);
});

test("MUA parity: schedule rows 1-4 match sheet exactly (decimals: null)", () => {
  const s = generateSchedule({
    principal: 10_000_000, annualRate: 0.16, tenorMonths: 36,
    startDate: new Date(2020, 7, 30), decimals: null,
  });
  const sheet = [
    { interest: 133333.33333333334, principal: 218236.99703016758, closing: 9781763.002969833 },
    { interest: 130423.50670626445, principal: 221146.82365723647, closing: 9560616.179312596 },
    { interest: 127474.88239083462, principal: 224095.4479726663,  closing: 9336520.73133993  },
    { interest: 124486.9430845324,  principal: 227083.38727896853, closing: 9109437.344060961 },
  ];
  sheet.forEach((row, i) => {
    const line = s.lines[i];
    assert.ok(near(line.interest, row.interest), `P${i+1} interest ${line.interest}`);
    assert.ok(near(line.principal, row.principal), `P${i+1} principal ${line.principal}`);
    assert.ok(near(line.closingBalance, row.closing), `P${i+1} closing ${line.closingBalance}`);
  });
});

// ── PRODUCTION: whole-shilling rounding, closes at exactly zero ──
test("production (UGX, decimals: 0): every line is a whole number", () => {
  const s = generateSchedule({
    principal: 10_000_000, annualRate: 0.16, tenorMonths: 36,
    startDate: new Date(2020, 7, 30), decimals: 0,
  });
  for (const l of s.lines) {
    assert.equal(l.interest % 1, 0, `interest not whole: ${l.interest}`);
    assert.equal(l.principal % 1, 0, `principal not whole: ${l.principal}`);
    assert.equal(l.closingBalance % 1, 0, `balance not whole: ${l.closingBalance}`);
  }
});

test("production: loan closes at EXACTLY zero (remainder absorption)", () => {
  const s = generateSchedule({
    principal: 10_000_000, annualRate: 0.16, tenorMonths: 36,
    startDate: new Date(2020, 7, 30), decimals: 0,
  });
  const last = s.lines[s.lines.length - 1];
  assert.equal(last.closingBalance, 0, `final balance ${last.closingBalance}`);
  assert.equal(last.period, 36);
});

// ── CURRENCY-AGNOSTIC: same engine, KES-style 2 decimals, no code change ──
test("currency-agnostic: decimals: 2 produces cent-precision, closes at zero", () => {
  const s = generateSchedule({
    principal: 500_000, annualRate: 0.14, tenorMonths: 12,
    startDate: new Date(2026, 0, 15), decimals: 2,
  });
  // every value rounded to 2 dp
  for (const l of s.lines) {
    assert.ok(near(l.instalment, Math.round(l.instalment * 100) / 100));
  }
  assert.equal(s.lines[s.lines.length - 1].closingBalance, 0);
});

// ── EARLY SETTLEMENT: balance floored at zero, never negative ──
test("early payment reduces balance directly, never goes negative", () => {
  const base = generateSchedule({
    principal: 10_000_000, annualRate: 0.16, tenorMonths: 36,
    startDate: new Date(2020, 7, 30), decimals: 0,
  });
  // apply a 4,000,000 extra payment after period 5 (as the sheet did)
  const after = applyEarlyPayment(base, {
    principal: 10_000_000, annualRate: 0.16, tenorMonths: 36,
    startDate: new Date(2020, 7, 30), decimals: 0,
  }, 5, 4_000_000);
  // no line may have a negative closing balance
  for (const l of after.lines) {
    assert.ok(l.closingBalance >= 0, `negative balance at P${l.period}: ${l.closingBalance}`);
  }
  // and it settles earlier than 36 periods
  assert.ok(after.lines.length < 36, `expected early settlement, got ${after.lines.length} periods`);
});

test("engine version is stamped", () => {
  assert.equal(ENGINE_VERSION, "amort-1.0.0");
});

// ── DAY-COUNT / LEAP YEAR: addMonths must respect actual month lengths ──
// (Phase 2, TASKS.md). Not exported directly — tested black-box through the
// due dates a real schedule produces, the same way every other caller uses it.
test("leap year: Jan 31 + 1 month lands on Mar 2 (Feb 2024 has 29 days)", () => {
  const s = generateSchedule({
    principal: 1_000_000, annualRate: 0.16, tenorMonths: 3,
    startDate: new Date(2024, 0, 31), decimals: 0,
  });
  const d = s.lines[0].dueDate;
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 2, `expected March (2), got month ${d.getMonth()}`);
  assert.equal(d.getDate(), 2, `expected the 2nd, got ${d.getDate()}`);
});

test("non-leap year: the SAME Jan 31 + 1 month lands on Mar 3 (Feb 2023 has 28 days)", () => {
  const s = generateSchedule({
    principal: 1_000_000, annualRate: 0.16, tenorMonths: 3,
    startDate: new Date(2023, 0, 31), decimals: 0,
  });
  const d = s.lines[0].dueDate;
  assert.equal(d.getFullYear(), 2023);
  assert.equal(d.getMonth(), 2, `expected March (2), got month ${d.getMonth()}`);
  assert.equal(d.getDate(), 3, `expected the 3rd, got ${d.getDate()}`);
});

test("due dates stay strictly increasing across a schedule spanning a leap February", () => {
  const s = generateSchedule({
    principal: 5_000_000, annualRate: 0.14, tenorMonths: 6,
    startDate: new Date(2024, 0, 29), decimals: 0,
  });
  for (let i = 1; i < s.lines.length; i++) {
    assert.ok(
      s.lines[i].dueDate.getTime() > s.lines[i - 1].dueDate.getTime(),
      `period ${s.lines[i].period} due date did not advance past period ${s.lines[i - 1].period}`,
    );
  }
});