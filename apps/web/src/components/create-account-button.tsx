"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Loader2, MailCheck } from "lucide-react";
import { createAccountAction } from "@/app/settings/employees-actions";

// Invite-based (spec §7.4) — no password is ever generated or seen here. The
// invitee sets their own via the emailed link (or, if their email already
// has a Wola account from another tenant, just confirms joining this one).
export default function CreateAccountButton({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultEmail, setResultEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createAccountAction(employeeId, email);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResultEmail(res.email);
      router.refresh();
    });
  }

  if (resultEmail) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 p-2 text-xs text-ink">
        <MailCheck className="h-3.5 w-3.5 shrink-0 text-brand-700" />
        Invitation sent to {resultEmail}.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Invite to Wola
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@company.com"
          className="num w-36 rounded-md border border-rule bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
        />
        <button
          onClick={submit}
          disabled={pending}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand text-brand-ink disabled:opacity-60"
          aria-label="Send invitation"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
        </button>
      </div>
      {error ? <span className="text-xs text-rejected">{error}</span> : null}
    </div>
  );
}
