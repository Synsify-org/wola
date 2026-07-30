"use client";
import { Check, X } from "lucide-react";

const label = (r: string) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

type Stage = { id: string; approverRole: string };

export default function StatusTimeline({
  stages,
  completedIds,
  currentId,
  rejectedId,
}: {
  stages: Stage[];
  completedIds: string[];
  currentId: string | null;
  rejectedId: string | null;
}) {
  const done = new Set(completedIds);

  return (
    <div className="rounded-xl border border-rule bg-surface p-5 shadow-theme-sm">
      <div className="caps mb-4">Approval timeline</div>
      <ol className="relative">
        {stages.map((s, i) => {
          const isDone = done.has(s.id);
          const isNow = currentId === s.id;
          const isVoid = rejectedId === s.id;
          const isLast = i === stages.length - 1;

          const dot = isVoid
            ? "bg-error-600 text-white"
            : isDone
            ? "bg-success-600 text-white"
            : isNow
            ? "bg-brand text-white ring-4 ring-brand-100"
            : "bg-gray-100 text-gray-400";

          const line = isDone || isVoid ? "bg-success-600" : "bg-gray-200";

          return (
            <li key={s.id} className="flex gap-3 pb-5 last:pb-0">
              {/* Dot + connector */}
              <div className="flex flex-col items-center">
                <span className={"grid h-7 w-7 shrink-0 place-items-center rounded-full " + dot}>
                  {isVoid ? (
                    <X className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : isDone ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : (
                    <span className="num text-xs font-semibold">{i + 1}</span>
                  )}
                </span>
                {!isLast ? (
                  <span className={"mt-1 w-0.5 flex-1 rounded-full " + line} style={{ minHeight: "1.5rem" }} />
                ) : null}
              </div>

              {/* Label */}
              <div className="pt-1">
                <div
                  className={
                    "text-sm font-medium " +
                    (isVoid
                      ? "text-error-700"
                      : isDone
                      ? "text-ink"
                      : isNow
                      ? "text-brand-700"
                      : "text-ink-faint")
                  }
                >
                  {label(s.approverRole)}
                </div>
                <div className="text-xs text-ink-soft">
                  {isVoid
                    ? "Rejected here"
                    : isDone
                    ? "Approved"
                    : isNow
                    ? "Awaiting decision"
                    : "Pending"}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
