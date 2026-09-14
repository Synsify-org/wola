// packages/engine/src/currency.ts
// Pure currency formatting — no I/O, no tenant/DB knowledge. Decimal places
// come from Intl's own ISO 4217 data rather than a hand-maintained map, so
// any real currency code (UGX/TZS/RWF at 0 decimals, KES/USD at 2, ...)
// resolves correctly with no per-currency code to add here.

// East African shillings/francs are dealt with as whole units in practice
// region-wide, even though ISO 4217 formally allows 2 decimal places for
// some of them (Intl reports TZS as 2, not 0). This overrides Intl for
// exactly the currencies amortization.ts's own header comment already
// documents as 0-decimal ("UGX (0 decimals) ... TZS/RWF (0)") — everything
// else defers to Intl's real ISO 4217 data.
const ZERO_DECIMAL_OVERRIDES = new Set(["UGX", "TZS", "RWF"]);

/** Number of minor-unit decimal places for a currency code. */
export function getCurrencyDecimals(code: string): number {
  if (ZERO_DECIMAL_OVERRIDES.has(code.toUpperCase())) return 0;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // Unrecognized code — 2 is the common case and the safer default
    // (an unexpected extra decimal is less harmful than silently dropping one).
    return 2;
  }
}

/** "{CODE} {grouped number}" — the app's existing display convention (a
 *  code prefix, not a currency symbol), decimals resolved per currency. */
export function formatMoney(amount: number, code: string): string {
  const decimals = getCurrencyDecimals(code);
  const grouped = amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return code + " " + grouped;
}
