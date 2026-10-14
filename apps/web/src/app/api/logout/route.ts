// apps/web/src/app/api/logout/route.ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logout, SESSION_COOKIE } from "@/lib/auth";
import { FLASH_COOKIE, FLASH_MAX_AGE } from "@/lib/flash";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  await logout(token);
  store.delete(SESSION_COOKIE);
  // The login page says "You've been signed out" (readable by the page, so not httpOnly).
  store.set(FLASH_COOKIE, "signed-out", { path: "/", maxAge: FLASH_MAX_AGE, sameSite: "lax" });
  redirect("/login");
}