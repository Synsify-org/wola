"use client";
// "Your details": who you are on the record (read-only, kept by HR) and how finance can
// reach you (yours to edit). Sectioned like a profile form: one heading per group,
// icon-labelled fields in a grid that is one column on a phone.
import { useState, useTransition } from "react";
import { Briefcase, Building2, Hash, Loader2, Mail, MapPin, Phone, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMyDetailsAction } from "@/app/(app)/settings/details-actions";

function ReadOnly({ icon: Icon, label, value, id }: { icon: typeof User; label: string; value: string; id: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-2 text-ink-soft">
        <Icon className="h-4 w-4 text-ink-faint" aria-hidden /> {label}
      </Label>
      <Input id={id} value={value || "—"} readOnly className="bg-paper text-ink" />
    </div>
  );
}

export default function MyDetailsForm({
  name, email, employeeNo, department, title, phone: phone0, location: location0, hasRecord,
}: {
  name: string; email: string; employeeNo: string; department: string; title: string;
  phone: string; location: string; hasRecord: boolean;
}) {
  const [phone, setPhone] = useState(phone0);
  const [location, setLocation] = useState(location0);
  const [saved, setSaved] = useState({ phone: phone0, location: location0 });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; field?: string } | null>(null);
  const dirty = phone.trim() !== saved.phone || location.trim() !== saved.location;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await updateMyDetailsAction({ phone, location });
      if (r.ok) {
        setSaved({ phone: phone.trim(), location: location.trim() });
        setMsg({ ok: true, text: "Saved." });
      } else {
        setMsg({ ok: false, text: r.error, field: r.field });
      }
    });
  }

  return (
    <form onSubmit={save} className="space-y-8">
      <section aria-labelledby="who-h">
        <h3 id="who-h" className="text-sm font-semibold text-ink">Who you are on record</h3>
        <p className="mt-0.5 text-xs text-ink-soft">Kept by HR. Ask them if something here is wrong.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ReadOnly id="d-name" icon={User} label="Full name" value={name} />
          <ReadOnly id="d-email" icon={Mail} label="Sign-in email" value={email} />
          <ReadOnly id="d-no" icon={Hash} label="Employee number" value={employeeNo} />
          <ReadOnly id="d-dept" icon={Building2} label="Department" value={department} />
          <ReadOnly id="d-title" icon={Briefcase} label="Title" value={title} />
        </div>
      </section>

      <section aria-labelledby="contact-h">
        <h3 id="contact-h" className="text-sm font-semibold text-ink">How to reach you</h3>
        <p className="mt-0.5 text-xs text-ink-soft">Optional. Finance uses this if a deduction needs sorting out.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="d-phone" className="flex items-center gap-2"><Phone className="h-4 w-4 text-ink-faint" aria-hidden /> Phone number</Label>
            <Input id="d-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+256 772 123 456" disabled={!hasRecord}
              value={phone} onChange={(e) => { setPhone(e.target.value); setMsg(null); }} aria-invalid={msg?.field === "phone"} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="d-loc" className="flex items-center gap-2"><MapPin className="h-4 w-4 text-ink-faint" aria-hidden /> Location</Label>
            <Input id="d-loc" autoComplete="address-level2" placeholder="e.g. Kampala, Head office" disabled={!hasRecord}
              value={location} onChange={(e) => { setLocation(e.target.value); setMsg(null); }} maxLength={120} aria-invalid={msg?.field === "location"} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-rule pt-5">
        {msg ? <p role="status" className={`mr-auto text-sm ${msg.ok ? "text-approved" : "text-rejected"}`}>{msg.text}</p> : null}
        {!hasRecord ? <p className="mr-auto text-sm text-ink-soft">Your account isn&apos;t linked to an employee record, so there is nothing to edit yet.</p> : null}
        <button type="submit" disabled={!hasRecord || !dirty || pending}
          className="btn btn--primary inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save changes
        </button>
      </div>
    </form>
  );
}
