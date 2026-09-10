"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserX, UserCheck, Loader2 } from "lucide-react";
import { setEmployeeStatusAction } from "@/app/settings/employees-actions";

// Pure employee-status flip. Deliberately does NOT touch any loan — see the
// comment on setEmployeeStatusAction for why. A confirm step guards against
// an accidental click, same pattern as RepayButton/DisburseButton.
export default function EmployeeStatusButton({
  employeeId,
  status,
}: {
  employeeId: string;
  status: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const isActive = status === "active";
  const target = isActive ? "exited" : "active";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await setEmployeeStatusAction(employeeId, target);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      if (res.note) setNote(res.note);
      router.refresh();
    });
  }

  if (note) {
    return <p className="max-w-[14rem] text-xs text-awaiting">{note}</p>;
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className={
          "inline-flex items-center gap-1 text-xs font-medium hover:underline " +
          (isActive ? "text-ink-soft hover:text-rejected" : "text-ink-soft hover:text-brand")
        }
      >
        {isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
        {isActive ? "Deactivate" : "Reactivate"}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-ink-soft">{isActive ? "Deactivate?" : "Reactivate?"}</span>
        <button
          onClick={submit}
          disabled={pending}
          className={
            "rounded-md px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-60 " +
            (isActive ? "bg-rejected" : "bg-brand")
          }
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
        </button>
        <button onClick={() => setConfirming(false)} disabled={pending} className="text-xs text-ink-faint hover:text-ink-soft">
          Cancel
        </button>
      </div>
      {error ? <span className="text-xs text-rejected">{error}</span> : null}
    </div>
  );
}
