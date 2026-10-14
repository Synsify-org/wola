"use client";
// Form pieces shared by the sign-in screens: a frosted ("glass") field, a password field
// with show/hide and a Caps Lock warning, and the primary button. Everything is driven by
// our design tokens so a white-labelled organisation keeps its own brand colour.
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const frame =
  "rounded-2xl border border-rule bg-ink/[0.03] backdrop-blur-sm transition-[border-color,background-color,box-shadow] " +
  "focus-within:border-brand-300 focus-within:bg-brand-wash focus-within:ring-4 focus-within:ring-brand-100 " +
  "has-[[aria-invalid=true]]:border-error-300";

const inputCls =
  "h-12 w-full min-w-0 rounded-2xl bg-transparent px-4 text-[0.9375rem] text-ink outline-none placeholder:text-ink-faint " +
  "disabled:cursor-not-allowed disabled:opacity-60";

type FieldProps = Omit<ComponentProps<"input">, "className"> & {
  label: string;
  /** Right-aligned next to the label (e.g. "Forgot password?"). */
  aside?: ReactNode;
  hint?: ReactNode;
  className?: string;
};

export function AuthField({ label, aside, hint, id, className, ...input }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={fid} className="text-sm font-medium text-ink-soft">{label}</label>
        {aside}
      </div>
      <div className={frame}>
        <input id={fid} className={className ?? inputCls} {...input} />
      </div>
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function AuthPasswordField({
  label = "Password", aside, ...input
}: Omit<FieldProps, "type" | "label"> & { label?: string }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const auto = useId();
  const fid = input.id ?? auto;
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={fid} className="text-sm font-medium text-ink-soft">{label}</label>
        {aside}
      </div>
      <div className={`relative ${frame}`}>
        <input
          {...input}
          id={fid}
          type={show ? "text" : "password"}
          onKeyDown={key}
          onKeyUp={key}
          onBlur={(e) => { setCaps(false); input.onBlur?.(e); }}
          aria-describedby={caps ? `${fid}-caps` : input["aria-describedby"]}
          className={`${inputCls} pr-12`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute inset-y-0 right-1 grid w-11 place-items-center rounded-xl text-ink-faint transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
        >
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {caps ? <p id={`${fid}-caps`} role="status" className="text-xs font-medium text-awaiting">Caps Lock is on.</p> : null}
    </div>
  );
}

export function AuthButton({
  pending, pendingLabel, children, ...rest
}: Omit<ComponentProps<"button">, "className"> & { pending?: boolean; pendingLabel?: string }) {
  return (
    <button
      {...rest}
      disabled={pending || rest.disabled}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-[0.9375rem] font-semibold text-brand-ink transition-[background-color,transform,box-shadow] hover:bg-brand-700 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200"
    >
      {pending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {pendingLabel ?? "Working…"}</> : children}
    </button>
  );
}

export function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-error-200 bg-rejected-wash px-4 py-3 text-sm text-rejected">
      {children}
    </div>
  );
}
