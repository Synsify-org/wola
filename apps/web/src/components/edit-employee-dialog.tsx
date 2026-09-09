"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { updateEmployeeAction, type EmployeeUpdate } from "@/app/settings/employees-actions";

type Employee = {
  id: string;
  full_name: string;
  department: string | null;
  department_head_no: string | null;
  title: string | null;
  gross_salary: string;
  net_salary: string;
  is_post_probation: boolean;
  on_final_warning: boolean;
};

// One-off correction for a single employee — the bulk CSV import
// (employee-import.tsx) is the primary tool for routine payroll refreshes.
export default function EditEmployeeDialog({ employee }: { employee: Employee }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [fields, setFields] = useState<EmployeeUpdate>({
    full_name: employee.full_name,
    department: employee.department,
    department_head_no: employee.department_head_no,
    title: employee.title,
    gross_salary: Number(employee.gross_salary),
    net_salary: Number(employee.net_salary),
    is_post_probation: employee.is_post_probation,
    on_final_warning: employee.on_final_warning,
  });

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateEmployeeAction(employee.id, fields);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const inputCls = "num mt-1 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand";
  const labelCls = "text-xs font-medium text-ink-soft";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-brand"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {employee.full_name}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2">
            <span className={labelCls}>Full name</span>
            <input
              value={fields.full_name}
              onChange={(e) => setFields((f) => ({ ...f, full_name: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label>
            <span className={labelCls}>Department</span>
            <input
              value={fields.department ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, department: e.target.value || null }))}
              className={inputCls}
            />
          </label>
          <label>
            <span className={labelCls}>Title</span>
            <input
              value={fields.title ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, title: e.target.value || null }))}
              className={inputCls}
            />
          </label>
          <label className="col-span-2">
            <span className={labelCls}>Department head (employee no)</span>
            <input
              value={fields.department_head_no ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, department_head_no: e.target.value || null }))}
              className={inputCls}
            />
          </label>
          <label>
            <span className={labelCls}>Gross salary</span>
            <input
              type="number"
              value={fields.gross_salary}
              onChange={(e) => setFields((f) => ({ ...f, gross_salary: Number(e.target.value) }))}
              className={inputCls}
            />
          </label>
          <label>
            <span className={labelCls}>Net salary</span>
            <input
              type="number"
              value={fields.net_salary}
              onChange={(e) => setFields((f) => ({ ...f, net_salary: Number(e.target.value) }))}
              className={inputCls}
            />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={fields.is_post_probation}
              onChange={(e) => setFields((f) => ({ ...f, is_post_probation: e.target.checked }))}
            />
            Post-probation
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={fields.on_final_warning}
              onChange={(e) => setFields((f) => ({ ...f, on_final_warning: e.target.checked }))}
            />
            On final warning
          </label>
        </div>

        {error ? <p className="text-sm text-rejected">{error}</p> : null}

        <DialogFooter>
          <button onClick={() => setOpen(false)} disabled={pending} className="btn btn--ghost rounded-full text-sm">
            Cancel
          </button>
          <button onClick={submit} disabled={pending} className="btn btn--primary inline-flex items-center gap-2 rounded-full text-sm disabled:opacity-60">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {pending ? "Saving…" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
