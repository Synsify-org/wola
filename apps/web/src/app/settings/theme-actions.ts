"use server";
// Save the tenant's brand colours + font into tenants.settings.brand.
//
// Uses the normal app connection (wola_app) via requireSession. This requires
// migration 0010 (GRANT UPDATE (settings) ON tenants TO wola_app) to have been
// applied — a COLUMN-scoped grant so the app can write settings but still can't
// touch slug/status/plan. Admin-role check is enforced here in the app.
import { requireSession } from "@/lib/guard";
import { revalidatePath } from "next/cache";

const ADMIN_ROLES = ["cfo", "ceo", "md", "coo", "group_ceo", "admin", "org_admin"];
const HEX = /^#[0-9a-fA-F]{6}$/;

export type ThemeResult = { ok: true } | { ok: false; error: string };

export async function saveThemeAction(
  primary: string,
  accent: string,
  font: string,
): Promise<ThemeResult> {
  if (!HEX.test(primary)) return { ok: false, error: "Primary must be a #rrggbb hex colour." };
  if (!HEX.test(accent)) return { ok: false, error: "Accent must be a #rrggbb hex colour." };

  return requireSession(async (tx, ctx) => {
    if (!ADMIN_ROLES.includes(ctx.role)) {
      return { ok: false, error: "You are not authorised to change branding." };
    }
    try {
      await tx`
        UPDATE tenants
        SET settings = jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              '{brand}',
              ${tx.json({ primary, accent, font })}::jsonb,
              true
            )
        WHERE id = ${ctx.tenantId}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save branding.";
      // Most likely cause: migration 0010 not applied (app role lacks the
      // settings grant). Surface a clear hint rather than a raw pg error.
      if (/permission denied/i.test(msg)) {
        return { ok: false, error: "Branding permission missing — run migration 0010 (GRANT UPDATE (settings) ON tenants)." };
      }
      return { ok: false, error: msg };
    }

    revalidatePath("/", "layout");
    return { ok: true };
  });
}