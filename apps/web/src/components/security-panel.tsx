"use client";
// Two-step sign-in for the signed-in person: set up with an authenticator app,
// keep recovery codes, turn off, and (for administrators) choose which roles
// must use it. Codes are checked on the server; this component only drives the
// flow and never stores a secret in the browser beyond the setup screen.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Download, Loader2, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { MEMBERSHIP_ROLES } from "@wola/engine";
import DashboardCard from "./dashboard-card";
import { roleLabel } from "@/lib/product-summary";
import {
  startMfaAction, confirmMfaAction, disableMfaAction, newRecoveryCodesAction, saveMfaPolicyAction,
} from "@/app/(app)/settings/security/actions";

const inputCls =
  "h-10 w-full max-w-[14rem] rounded-xl border border-rule bg-surface px-3.5 text-center text-base tracking-widest text-ink shadow-theme-xs outline-none transition-[border-color,box-shadow] placeholder:tracking-normal placeholder:text-ink-faint hover:border-ink-faint/50 focus-visible:border-brand-300 focus-visible:ring-4 focus-visible:ring-brand-100";

const group = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl bg-awaiting-wash px-3.5 py-3 text-sm text-ink">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-awaiting" aria-hidden />
        <span>
          Save these recovery codes somewhere safe (a password manager, or printed). Each works <strong>once</strong>, if you
          lose your phone. We can&apos;t show them again.
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-rule bg-paper p-4 font-mono text-sm tracking-wider text-ink sm:grid-cols-5">
        {codes.map((c) => <li key={c} className="num">{c}</li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn--ghost h-9 rounded-full px-4 text-sm"
          onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard blocked */ } }}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn--ghost h-9 rounded-full px-4 text-sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`Wola recovery codes\n\n${text}\n`], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url; a.download = "wola-recovery-codes.txt"; a.click();
            URL.revokeObjectURL(url);
          }}>
          <Download className="h-4 w-4" /> Download
        </button>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
        I&apos;ve saved these codes
      </label>
      <button type="button" disabled={!saved} onClick={onDone} className="btn btn--primary h-10 rounded-full px-5 text-sm">Done</button>
    </div>
  );
}

function CodeForm({
  label, button, danger, onSubmit, pending, error,
}: { label: string; button: string; danger?: boolean; onSubmit: (code: string) => void; pending: boolean; error: string | null }) {
  const [code, setCode] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) onSubmit(code); }} className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
          placeholder="123 456" maxLength={24} className={inputCls} />
      </label>
      {error ? <p className="text-xs font-medium text-error-600">{error}</p> : null}
      <button type="submit" disabled={pending || !code.trim()}
        className={(danger ? "btn btn--danger" : "btn btn--primary") + " inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm"}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {button}
      </button>
    </form>
  );
}

type Res = { ok: boolean; error?: string } & Record<string, unknown>;
/** The four calls the panel makes. Tenant users get the defaults; the platform console
 *  passes its own (a different session and audit trail, the same flow). */
export type SecurityActions = {
  start: () => Promise<Res>;
  confirm: (code: string) => Promise<Res>;
  disable: (code: string) => Promise<Res>;
  renew: (code: string) => Promise<Res>;
};
const TENANT_ACTIONS: SecurityActions = {
  start: startMfaAction, confirm: confirmMfaAction, disable: disableMfaAction, renew: newRecoveryCodesAction,
};

export default function SecurityPanel({
  enrolled, recoveryCodesLeft, keyAvailable, requiredForMe, setupRequired, actions = TENANT_ACTIONS, requiredNote, introNote,
}: {
  actions?: SecurityActions;
  /** Overrides the "your organisation requires it" wording (the platform console says its own). */
  requiredNote?: string;
  /** Overrides the paragraph that explains what two-step sign-in is, before setup. */
  introNote?: string;
  enrolled: boolean;
  recoveryCodesLeft: number;
  keyAvailable: boolean;
  /** The organisation requires two-step sign-in for this person's role. */
  requiredForMe: boolean;
  /** They were sent here because they must set it up before using Wola. */
  setupRequired: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [panel, setPanel] = useState<"none" | "off" | "renew">("none");
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, then: (r: Record<string, unknown>) => void) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { setError((r.error as string) ?? "Something went wrong."); return; }
      then(r);
    });
  };

  if (codes) {
    return (
      <DashboardCard title="Your recovery codes" action={<ShieldCheck className="h-5 w-5 text-approved" aria-hidden />}>
        <RecoveryCodes codes={codes} onDone={() => { setCodes(null); setSetup(null); setPanel("none"); router.refresh(); }} />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard
      title="Two-step sign-in"
      action={enrolled
        ? <span className="chip chip--approved"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> On</span>
        : <span className="chip chip--awaiting"><ShieldOff className="h-3.5 w-3.5" aria-hidden /> Off</span>}
    >
      {setupRequired && !enrolled ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-awaiting-wash px-3.5 py-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-awaiting" aria-hidden />
          {requiredNote ?? "Your organisation requires two-step sign-in for your role. Set it up to carry on using Wola."}
        </div>
      ) : null}

      {!keyAvailable ? (
        <p className="text-sm text-ink-soft">
          Two-step sign-in isn&apos;t switched on for this server yet. An administrator needs to configure it; until then your
          password is the only step.
        </p>
      ) : enrolled ? (
        <div className="space-y-5">
          <p className="text-sm text-ink-soft">
            When you sign in, Wola asks for a code from your authenticator app after your password.
            {" "}You have <strong className="text-ink">{recoveryCodesLeft}</strong> unused recovery code{recoveryCodesLeft === 1 ? "" : "s"}.
          </p>
          {recoveryCodesLeft <= 2 ? (
            <p className="rounded-xl bg-awaiting-wash px-3.5 py-2.5 text-sm text-ink">Running low on recovery codes. Get a new set below.</p>
          ) : null}

          {panel === "renew" ? (
            <CodeForm label="Enter a code from your app to confirm it's you" button="Get new recovery codes" pending={pending} error={error}
              onSubmit={(c) => run(() => actions.renew(c), (r) => setCodes(r.recoveryCodes as string[]))} />
          ) : panel === "off" ? (
            <CodeForm danger label="Enter a code from your app (or a recovery code) to turn it off" button="Turn off two-step sign-in" pending={pending} error={error}
              onSubmit={(c) => run(() => actions.disable(c), () => { setPanel("none"); router.refresh(); })} />
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <button type="button" onClick={() => { setPanel("renew"); setError(null); }} className="btn btn--ghost h-10 rounded-full px-5 text-sm">
                New recovery codes
              </button>
              {requiredForMe ? (
                <span className="text-xs text-ink-soft">{requiredNote ? "Required for the platform console." : "Your organisation requires this for your role."}</span>
              ) : (
                <button type="button" onClick={() => { setPanel("off"); setError(null); }} className="text-sm font-medium text-rejected hover:underline">
                  Turn off
                </button>
              )}
            </div>
          )}
          {panel !== "none" ? (
            <button type="button" onClick={() => { setPanel("none"); setError(null); }} className="text-sm font-medium text-ink-soft hover:text-ink">Cancel</button>
          ) : null}
        </div>
      ) : setup ? (
        <div className="space-y-5">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink">
            <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
            <li>
              Add an account and enter this key (or{" "}
              <a href={setup.uri} className="font-medium text-brand-700 underline">open it in your app</a> on this phone):
              <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-rule bg-paper px-3.5 py-2 font-mono text-sm tracking-wider text-ink">
                <Smartphone className="h-4 w-4 text-ink-faint" aria-hidden />
                <span className="num select-all">{group(setup.secret)}</span>
              </div>
            </li>
            <li>Enter the 6-digit code it shows to finish.</li>
          </ol>
          <CodeForm label="6-digit code" button="Turn on" pending={pending} error={error}
            onSubmit={(c) => run(() => actions.confirm(c), (r) => setCodes(r.recoveryCodes as string[]))} />
          <button type="button" onClick={() => { setSetup(null); setError(null); }} className="text-sm font-medium text-ink-soft hover:text-ink">Cancel</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            {introNote ?? <>Add a second step to signing in: after your password, Wola asks for a 6-digit code from an app on your phone. A stolen
            or guessed password alone then can&apos;t open your account. Recommended for anyone who approves or pays out loans.</>}
          </p>
          {error ? <p className="text-xs font-medium text-error-600">{error}</p> : null}
          <button type="button" disabled={pending} onClick={() => run(() => actions.start(), (r) => setSetup({ secret: r.secret as string, uri: r.uri as string }))}
            className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Set up two-step sign-in
          </button>
        </div>
      )}
    </DashboardCard>
  );
}

/** Administrators: which roles must use two-step sign-in. */
export function MfaPolicyPanel({ initial, keyAvailable }: { initial: string[]; keyAvailable: boolean }) {
  const [roles, setRoles] = useState<string[]>(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = roles.slice().sort().join() !== initial.slice().sort().join();

  return (
    <DashboardCard title="Who must use it">
      <p className="mb-4 text-sm text-ink-soft">
        People in these roles can&apos;t use Wola until they&apos;ve set up two-step sign-in. Recommended for finance and
        administrators. {keyAvailable ? "" : "Switch-on needs the server to be configured first."}
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {MEMBERSHIP_ROLES.map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-rule bg-surface px-3.5 py-2.5 text-sm text-ink hover:border-brand-200">
            <input type="checkbox" disabled={!keyAvailable} checked={roles.includes(r)}
              onChange={(e) => { setRoles((cur) => e.target.checked ? [...cur, r] : cur.filter((x) => x !== r)); setMsg(null); }}
              className="size-4 accent-[var(--color-brand)]" />
            {roleLabel(r)}
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!keyAvailable || !dirty || pending}
          onClick={() => startTransition(async () => {
            const r = await saveMfaPolicyAction(roles);
            setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
          })}
          className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </button>
        {msg ? <span className={"text-sm font-medium " + (msg.ok ? "text-approved" : "text-error-600")}>{msg.text}</span> : null}
      </div>
      <p className="mt-3 text-xs text-ink-soft">Takes effect on the person&apos;s next click. You can&apos;t lock yourself out: you&apos;ll be asked to set it up first.</p>
    </DashboardCard>
  );
}
