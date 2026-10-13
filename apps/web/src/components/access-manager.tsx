"use client";
// People with access to this organisation: change a role, remove access, invite.
// Edit controls only render for administrators (the server action enforces it
// regardless); everyone else sees the list read-only.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, MailPlus, X } from "lucide-react";
import { MEMBERSHIP_ROLES } from "@wola/engine";
import { Avatar } from "@/components/ui/avatar";
import { OptionSelect } from "@/components/ui/select";
import DashboardCard from "./dashboard-card";
import { roleLabel } from "@/lib/product-summary";
import {
  changeRoleAction, removeAccessAction, inviteAction, revokeInviteAction,
} from "@/app/(app)/settings/access/actions";

export interface AccessPersonView {
  userId: string;
  email: string;
  name: string;
  role: string;
  employeeNo: string | null;
  department: string | null;
  title: string | null;
  isYou: boolean;
}
export interface InviteView { id: string; email: string; role: string; expiresOn: string }

const roleOptions = MEMBERSHIP_ROLES.map((r) => ({ value: r, label: roleLabel(r) }));
const inputCls =
  "h-10 w-full rounded-xl border border-rule bg-surface px-3.5 text-sm text-ink shadow-theme-xs outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-ink-faint/50 focus-visible:border-brand-300 focus-visible:ring-4 focus-visible:ring-brand-100";

function PersonRow({ p, canEdit }: { p: AccessPersonView; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error ?? "Something went wrong."); return; }
      setConfirming(false);
      router.refresh();
    });
  };

  const detail = [p.employeeNo, p.department, p.title].filter(Boolean).join(" · ");
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
          <Avatar name={p.name} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-ink">{p.name}</span>
              {p.isYou ? <span className="chip">You</span> : null}
            </div>
            <div className="truncate text-xs text-ink-soft">{p.email}{detail ? ` · ${detail}` : ""}</div>
          </div>
        </div>

        {canEdit && !p.isYou ? (
          <>
            <div className="w-44 shrink-0">
              <OptionSelect
                ariaLabel={`Role for ${p.name}`}
                value={p.role}
                disabled={pending}
                size="sm"
                onValueChange={(v) => run(() => changeRoleAction(p.userId, v))}
                options={roleOptions}
              />
            </div>
            {confirming ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-ink-soft">Remove access?</span>
                <button disabled={pending} onClick={() => run(() => removeAccessAction(p.userId))}
                  className="btn btn--danger h-9 rounded-full px-3 text-xs">
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Remove
                </button>
                <button disabled={pending} onClick={() => setConfirming(false)} className="text-xs font-medium text-ink-soft hover:text-ink">Keep</button>
              </div>
            ) : (
              <button onClick={() => setConfirming(true)} className="text-xs font-medium text-rejected hover:underline">
                Remove access
              </button>
            )}
          </>
        ) : (
          <span className="chip chip--approved">{roleLabel(p.role)}</span>
        )}
      </div>
      {error ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-rejected-wash px-3 py-2 text-xs text-rejected">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      ) : null}
    </li>
  );
}

export default function AccessManager({
  people, invites, employeesWithoutLogin, canEdit,
}: {
  people: AccessPersonView[];
  invites: InviteView[];
  employeesWithoutLogin: { id: string; name: string; employeeNo: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("employee");
  const [employeeId, setEmployeeId] = useState<string>("none");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function invite() {
    setMsg(null);
    startTransition(async () => {
      const res = await inviteAction(email, role, employeeId === "none" ? null : employeeId);
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setMsg({ kind: "ok", text: res.note ?? "Invitation sent." });
      setEmail(""); setEmployeeId("none");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-rule bg-surface shadow-theme-xs">
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-5 sm:px-5">
          <h2 className="text-[1.0625rem] font-semibold text-ink">People with access</h2>
          <span className="text-xs text-ink-soft">{people.length} {people.length === 1 ? "person" : "people"}</span>
        </div>
        <ul className="divide-y divide-rule border-t border-rule">
          {people.map((p) => <PersonRow key={p.userId} p={p} canEdit={canEdit} />)}
        </ul>
      </section>

      {invites.length > 0 ? (
        <DashboardCard title="Waiting to accept">
          <ul className="divide-y divide-rule">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{i.email}</div>
                  <div className="text-xs text-ink-soft">As {roleLabel(i.role)} · link expires {i.expiresOn}</div>
                </div>
                {canEdit ? (
                  <button disabled={pending}
                    onClick={() => startTransition(async () => { await revokeInviteAction(i.id); router.refresh(); })}
                    className="inline-flex items-center gap-1 text-xs font-medium text-rejected hover:underline">
                    <X className="h-3.5 w-3.5" /> Cancel invitation
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </DashboardCard>
      ) : null}

      {canEdit ? (
        <DashboardCard title="Invite someone">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Work email</span>
              <input value={email} onChange={(e) => { setEmail(e.target.value); setMsg(null); }}
                type="email" placeholder="name@company.com" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Role</span>
              <OptionSelect ariaLabel="Role for the invitee" value={role} onValueChange={(v) => { setRole(v); setMsg(null); }} options={roleOptions} />
            </label>
            {employeesWithoutLogin.length > 0 ? (
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-ink">Link to an employee record <span className="font-normal text-ink-soft">(optional)</span></span>
                <OptionSelect ariaLabel="Employee record to link" value={employeeId} onValueChange={(v) => { setEmployeeId(v); setMsg(null); }}
                  options={[{ value: "none", label: "Not an employee (e.g. an auditor)" },
                    ...employeesWithoutLogin.map((e) => ({ value: e.id, label: e.name, hint: e.employeeNo }))]} />
              </label>
            ) : null}
          </div>
          {msg ? (
            <p className={"mt-3 text-sm font-medium " + (msg.kind === "ok" ? "text-approved" : "text-error-600")}>
              {msg.kind === "ok" ? <Check className="mr-1 inline h-4 w-4" /> : null}{msg.text}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            <button onClick={invite} disabled={pending || !email.trim()} className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full text-sm">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
              Send invitation
            </button>
            <p className="text-xs text-ink-soft">They choose their own password. The link works for 7 days.</p>
          </div>
        </DashboardCard>
      ) : null}
    </div>
  );
}
