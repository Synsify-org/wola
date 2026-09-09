// apps/web/src/lib/theme.ts
// White-label theming. A tenant sets a PRIMARY (structural) and ACCENT (action)
// colour; this derives the CSS custom properties the design system reads. Only
// brand tokens move per tenant — state colours (approved/rejected/awaiting)
// stay system-owned so an approver never misreads a rejected item as branding.
//
// The ramp is derived by mixing the base colour toward white (lighter steps)
// and black (darker steps). Not perceptually perfect, but stable and legible
// for arbitrary brand colours — good enough that MUA navy or a bank's gold both
// produce a coherent UI without a designer touching it.

export type TenantBrand = { primary?: string; accent?: string; font?: string };

// The fonts a tenant may choose. Keys match CSS variables loaded in the root
// layout via next/font (fonts must be loaded at build time — an admin can only
// pick from this curated set, not an arbitrary font). Value is the CSS var the
// app's --font-sans will point at.
export const FONT_OPTIONS: { id: string; label: string; varName: string }[] = [
  { id: "outfit", label: "Outfit (default)", varName: "--font-outfit" },
  { id: "inter", label: "Inter", varName: "--font-inter" },
  { id: "hanken", label: "Hanken Grotesk", varName: "--font-hanken" },
  { id: "libre", label: "Libre Franklin", varName: "--font-libre" },
  { id: "sourceSans", label: "Source Sans 3", varName: "--font-source" },
];

function fontVar(id: string | undefined): string | null {
  const opt = FONT_OPTIONS.find((f) => f.id === id);
  return opt ? opt.varName : null;
}

// #rrggbb -> [r,g,b]
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

// mix colour toward a target (white=255 or black=0) by t in [0,1]
function mix([r, g, b]: [number, number, number], target: number, t: number) {
  return toHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

// Relative luminance -> pick black or white ink for contrast on a given bg.
function ink([r, g, b]: [number, number, number]) {
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.6 ? "#0b1220" : "#ffffff";
}

/** Produce the CSS variable map for a tenant brand. Returns {} for the default
 *  (no overrides) so the globals.css forest-green stays untouched. */
export function deriveThemeVars(brand: TenantBrand | null | undefined): Record<string, string> {
  if (!brand) return {};
  const vars: Record<string, string> = {};

  const primary = brand.primary ? hexToRgb(brand.primary) : null;
  if (primary) {
    // Ramp 25..950 from lightest (mix toward white) to darkest (toward black).
    vars["--color-brand-25"] = mix(primary, 255, 0.95);
    vars["--color-brand-50"] = mix(primary, 255, 0.90);
    vars["--color-brand-100"] = mix(primary, 255, 0.80);
    vars["--color-brand-200"] = mix(primary, 255, 0.64);
    vars["--color-brand-300"] = mix(primary, 255, 0.48);
    vars["--color-brand-400"] = mix(primary, 255, 0.24);
    vars["--color-brand-500"] = brand.primary!;
    vars["--color-brand-600"] = mix(primary, 0, 0.12);
    vars["--color-brand-700"] = mix(primary, 0, 0.24);
    vars["--color-brand-800"] = mix(primary, 0, 0.36);
    vars["--color-brand-900"] = mix(primary, 0, 0.48);
    vars["--color-brand-950"] = mix(primary, 0, 0.60);
    // Solid semantic aliases used across components.
    vars["--color-brand"] = mix(primary, 0, 0.12);       // deep-ish primary
    vars["--color-brand-deep"] = mix(primary, 0, 0.30);
    vars["--color-brand-ink"] = ink(primary);            // legible text on brand
    vars["--color-brand-wash"] = mix(primary, 255, 0.88);
  }

  const accent = brand.accent ? hexToRgb(brand.accent) : null;
  if (accent) {
    // Accent drives calls-to-action / highlights. Kept as a small set.
    vars["--color-accent-50"] = mix(accent, 255, 0.88);
    vars["--color-accent-200"] = mix(accent, 255, 0.60);
    vars["--color-accent-500"] = brand.accent!;
    vars["--color-accent-600"] = mix(accent, 0, 0.12);
    vars["--color-accent-700"] = mix(accent, 0, 0.24);
    vars["--color-accent-ink"] = ink(accent);
  }

  // Font choice: repoint --font-sans at the chosen loaded font variable.
  const fv = fontVar(brand.font);
  if (fv) {
    vars["--font-sans"] = `var(${fv}), system-ui, sans-serif`;
  }

  return vars;
}

/** Serialize the vars into an inline style string for the <body> element. */
export function themeStyle(brand: TenantBrand | null | undefined): React.CSSProperties {
  return deriveThemeVars(brand) as React.CSSProperties;
}
