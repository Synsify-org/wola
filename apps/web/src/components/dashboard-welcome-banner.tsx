// apps/web/src/components/dashboard-welcome-banner.tsx
// One animated hero banner at the top of the Dashboard route, replacing the
// plain "Dashboard" h1 + subtitle every role's dashboard used to render on
// its own (8 copies of the same pattern — consolidated here). Personalized
// (time-of-day greeting + first name), carries the role's own "one question"
// from the architecture doc as the subtitle, same content as before, just
// one hero treatment instead of eight identical headers.
import { Building2 } from "lucide-react";

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good evening";
};

export default function DashboardWelcomeBanner({
  name,
  tenantName,
  subtitle,
}: {
  name: string;
  tenantName: string;
  subtitle: string;
}) {
  const firstName = name.split(" ")[0];

  return (
    <div
      className="relative mb-6 overflow-hidden rounded-xl p-6 text-white shadow-theme-md animate-in fade-in slide-in-from-bottom-2 duration-500 sm:p-8"
      style={{
        background:
          "linear-gradient(135deg, var(--color-brand-800), var(--color-brand-600) 60%, var(--color-brand-500))",
      }}
    >
      {/* Decorative mark — quiet, not competing with the text */}
      <Building2
        className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-white/10 sm:h-48 sm:w-48"
        strokeWidth={1}
        aria-hidden
      />

      <div className="relative">
        <p className="text-sm font-medium text-white/70">
          {greeting()}, {firstName} &middot; {tenantName}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          Dashboard
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/80">{subtitle}</p>
      </div>
    </div>
  );
}
