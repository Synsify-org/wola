"use client";
import { useState, useEffect } from "react";
import { HexColorPicker } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const HEX = /^#[0-9a-fA-F]{6}$/;

// A proper picker (saturation/hue canvas + swatch trigger) instead of the
// native OS <input type=color> dialog, which looks and behaves differently
// per browser/OS and doesn't match the rest of the app's chrome.
export default function ColorPickerPopover({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  // Keep the text field in sync if the parent value changes externally
  // (e.g. switching between saved/unsaved state) without fighting the user
  // mid-edit — only resync while the popover is closed.
  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  const valid = HEX.test(draft);

  function commitText(next: string) {
    setDraft(next);
    if (HEX.test(next)) onChange(next);
  }

  return (
    <div>
      <label className="caps mb-1.5 block">{label}</label>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="h-9 w-9 shrink-0 rounded-lg border border-rule shadow-theme-xs transition-transform active:scale-95"
              style={{ background: valid ? draft : "#cccccc" }}
              aria-label={`Pick ${label.toLowerCase()} colour`}
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3">
            <HexColorPicker
              color={valid ? draft : "#000000"}
              onChange={(hex) => { setDraft(hex); onChange(hex); }}
            />
          </PopoverContent>
        </Popover>
        <input
          type="text"
          value={draft}
          onChange={(e) => commitText(e.target.value)}
          placeholder="#000000"
          className={
            "num w-full min-w-0 rounded-lg border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand " +
            (valid ? "border-rule" : "border-error-600")
          }
        />
      </div>
    </div>
  );
}
