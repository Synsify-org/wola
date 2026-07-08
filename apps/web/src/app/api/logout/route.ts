// apps/web/src/app/api/logout/route.ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logout, SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  await logout(token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}