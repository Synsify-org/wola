// How long an application has been waiting at the current approver, and
// whether that's past the time limit the administrator set for the stage.
export function waitingFor(sinceIso: string, slaHours: number | null | undefined, now = Date.now()) {
  const hours = Math.max(0, (now - new Date(sinceIso).getTime()) / 3_600_000);
  const text =
    hours < 1 ? "under an hour"
    : hours < 48 ? `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}`
    : `${Math.floor(hours / 24)} days`;
  return { text, overdue: slaHours != null && hours > slaHours, hours };
}
