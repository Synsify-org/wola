"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Palette, Loader2, Check } from "lucide-react";
import { saveThemeAction } from "@/app/settings/theme-actions";
import { FONT_OPTIONS } from "@/lib/theme";
import ColorPickerPopover from "./color-picker-popover";
import DashboardCard from "./dashboard-card";

const HEX = /^#[0-9a-fA-F]{6}$/;

// Admin-only appearance editor: primary + accent colour and font. Live
// preview renders a small mock card in the actual chosen colours before
// saving; on save the whole app re-themes.
export default function ThemeEditor({
  initialPrimary,
  initialAccent,
  initialFont,
}: {
  initialPrimary: string;
  initialAccent: string;
  initialFont: string;
}) {
  const [primary, setPrimary] = useState(initialPrimary);
  const [accent, setAccent] = useState(initialAccent);
  const [font, setFont] = useState(initialFont);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const validPrimary = HEX.test(primary);
  const validAccent = HEX.test(accent);
  const dirty = () => { setSaved(false); setError(null); };

  function save() {
    setError(null);
    setSaved(false);
    if (!validPrimary || !validAccent) { setError("Both colours must be #rrggbb hex."); return; }
    startTransition(async () => {
      const res = await saveThemeAction(primary, accent, font);
      if (res.ok) { setSaved(true); router.refresh(); }
      else setError(res.error);
    });
  }

  return (
    <DashboardCard title="Appearance">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr_auto_auto]">
        <ColorPickerPopover
          label="Primary"
          value={primary}
          onChange={(v) => { setPrimary(v); dirty(); }}
        />
        <ColorPickerPopover
          label="Accent"
          value={accent}
          onChange={(v) => { setAccent(v); dirty(); }}
        />

        <div>
          <label className="caps mb-1.5 block">Font</label>
          <select
            value={font}
            onChange={(e) => { setFont(e.target.value); dirty(); }}
            className="h-9.5 w-full min-w-[10rem] rounded-lg border border-rule bg-surface px-3 text-sm text-ink outline-none focus:border-brand"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>

        {/* Preview — a tiny mock card in the actual chosen colours. */}
        <div>
          <label className="caps mb-1.5 block">Preview</label>
          <div className="flex h-[7.5rem] w-40 flex-col justify-between rounded-xl border border-rule bg-paper p-3 shadow-theme-xs">
            <div className="flex items-center gap-1.5">
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[0.65rem] font-bold text-white"
                style={{ background: validPrimary ? primary : "#ccc" }}
              >
                Aa
              </span>
              <div className="h-1.5 flex-1 rounded-full bg-gray-200" />
            </div>
            <div className="h-1.5 w-3/4 rounded-full bg-gray-200" />
            <button
              type="button"
              tabIndex={-1}
              className="rounded-full px-2.5 py-1 text-[0.65rem] font-semibold text-white"
              style={{ background: validAccent ? accent : "#ccc" }}
            >
              Action
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="mt-4 text-xs font-medium text-error-600">{error}</p> : null}

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          className="btn btn--primary inline-flex items-center gap-2 rounded-full text-sm disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Palette className="h-4 w-4" />}
          {pending ? "Applying…" : saved ? "Applied" : "Save & apply"}
        </button>
        <span className="text-xs text-ink-soft">Applies across the whole app.</span>
      </div>
    </DashboardCard>
  );
}
