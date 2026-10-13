import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthsSpanned, addMonthsIso, effectiveDueDate, windowsOverlap, cycleBounds, shiftCycle, dayBefore,
} from "../dist/index.js";

test("months spanned counts the calendar months a holiday touches", () => {
  assert.equal(monthsSpanned({ from: "2026-11-01", to: "2026-11-30" }), 1);
  assert.equal(monthsSpanned({ from: "2026-11-15", to: "2026-12-14" }), 2);
  assert.equal(monthsSpanned({ from: "2026-12-01", to: "2027-02-28" }), 3);
  assert.throws(() => monthsSpanned({ from: "2026-11-30", to: "2026-10-01" }));
});

test("adding months keeps the day, clamping to short months and crossing years", () => {
  assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsIso("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsIso("2026-11-15", 2), "2027-01-15");
  assert.equal(addMonthsIso("2026-03-31", -1), "2026-02-28");
});

test("a holiday moves its own instalment and every later one by the same number of months; earlier ones don't move", () => {
  const w = [{ from: "2026-11-01", to: "2026-11-30" }];
  assert.equal(effectiveDueDate("2026-10-25", w), "2026-10-25");
  assert.equal(effectiveDueDate("2026-11-25", w), "2026-12-25", "November's instalment is deferred, not skipped");
  assert.equal(effectiveDueDate("2026-12-25", w), "2027-01-25");
  assert.equal(effectiveDueDate("2027-05-25", w), "2027-06-25");
});

test("no holidays: dates are unchanged", () => {
  assert.equal(effectiveDueDate("2026-11-25", []), "2026-11-25");
});

test("two holidays stack, the second applied to dates already moved by the first", () => {
  const w = [{ from: "2027-03-01", to: "2027-03-31" }, { from: "2026-11-01", to: "2026-11-30" }]; // order given doesn't matter
  // 2027-02-25 -> +1 (Nov) = 2027-03-25, which now falls in March's holiday -> +1 = 2027-04-25
  assert.equal(effectiveDueDate("2027-02-25", w), "2027-04-25");
  assert.equal(effectiveDueDate("2026-10-25", w), "2026-10-25");
});

test("overlap detection is inclusive of shared end days", () => {
  assert.equal(windowsOverlap({ from: "2026-11-01", to: "2026-11-30" }, { from: "2026-11-30", to: "2026-12-31" }), true);
  assert.equal(windowsOverlap({ from: "2026-11-01", to: "2026-11-30" }, { from: "2026-12-01", to: "2026-12-31" }), false);
});

test("payroll cycles: bounds, labels, neighbours", () => {
  assert.deepEqual(cycleBounds("2026-02"), { start: "2026-02-01", end: "2026-02-28", label: "February 2026" });
  assert.equal(cycleBounds("2028-02").end, "2028-02-29");
  assert.throws(() => cycleBounds("2026-13"));
  assert.throws(() => cycleBounds("26-01"));
  assert.equal(shiftCycle("2026-12", 1), "2027-01");
  assert.equal(shiftCycle("2026-01", -1), "2025-12");
  assert.equal(dayBefore("2026-03-01"), "2026-02-28");
});
