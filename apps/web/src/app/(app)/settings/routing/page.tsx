// Approval routing: who approves each loan product, and in what order.
// Everyone with the administration view can read it; only administrators can
// change it (ROUTING_EDIT_ROLES — also enforced in the server action).
import Link from "next/link";
import { listRouting } from "@wola/db";
import { requireSession } from "@/lib/guard";
import { CONFIG_VIEW_ROLES, ROUTING_EDIT_ROLES } from "@/lib/permissions";
import RoutingEditor from "@/components/routing-editor";

export default async function RoutingPage() {
  const data = await requireSession(async (tx, ctx) => {
    if (!CONFIG_VIEW_ROLES.includes(ctx.role)) return { authorized: false as const };
    return {
      authorized: true as const,
      routing: await listRouting(tx),
      canEdit: ROUTING_EDIT_ROLES.includes(ctx.role),
    };
  });

  if (!data.authorized) {
    return (
      <div className="rounded-xl border border-rule bg-surface p-8 text-center shadow-theme-sm">
        <p className="text-sm text-ink-soft">Approval routing is available to administrators and executives only.</p>
      </div>
    );
  }
  const { routing, canEdit } = data;
  const unrouted = routing.filter((p) => p.active && !p.chains.some((c) => c.appliesTo === "default"));

  return (
    <>
      <div className="mb-6">
        <Link href="/settings" className="text-xs font-medium text-ink-soft hover:text-ink">← Settings</Link>
        <h1 className="mt-1 text-xl font-semibold text-ink">Approval routing</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Who approves each loan product, in order. An application moves to the next approver after each approval,
          and stops for good on a rejection.
        </p>
      </div>

      {!canEdit ? (
        <div className="mb-4 rounded-xl bg-awaiting-wash px-4 py-2.5 text-sm text-ink">
          View only. Approval routing is changed by an administrator — the people on a chain can&apos;t rewire it.
        </div>
      ) : null}

      {unrouted.length > 0 ? (
        <div className="mb-4 rounded-xl bg-rejected-wash px-4 py-2.5 text-sm text-rejected">
          {unrouted.map((p) => p.productName).join(", ")} {unrouted.length === 1 ? "has" : "have"} no approvers, so applications for
          {unrouted.length === 1 ? " it" : " them"} can&apos;t be approved yet.
        </div>
      ) : null}

      {routing.length === 0 ? (
        <div className="rounded-2xl border border-rule bg-surface p-12 text-center shadow-theme-xs">
          <p className="text-sm text-ink-soft">
            No loan products yet. <Link href="/settings/products" className="font-medium text-brand-700 underline">Create one</Link> first.
          </p>
        </div>
      ) : (
        <div className="max-w-4xl space-y-4">
          {routing.map((p) => (
            <RoutingEditor key={p.productId} product={p} canEdit={canEdit} />
          ))}
        </div>
      )}

      <p className="mt-5 max-w-4xl text-xs text-ink-soft">
        Changing the order or the approvers affects new applications only, and is locked while applications for that
        product are still in review. Past decisions always keep the chain they were made under.
      </p>
    </>
  );
}
