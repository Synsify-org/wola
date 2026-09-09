"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { superLogout, SUPER_SESSION_COOKIE } from "@/lib/super-admin-auth";

export async function superLogoutAction() {
  const token = (await cookies()).get(SUPER_SESSION_COOKIE)?.value;
  await superLogout(token);
  (await cookies()).delete(SUPER_SESSION_COOKIE);
  redirect("/admin/login");
}
