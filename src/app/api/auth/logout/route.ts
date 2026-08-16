import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/zh-CN", request.url));
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    try { await revokeSession(token); } catch { /* cookie deletion still logs the browser out */ }
    response.cookies.delete(SESSION_COOKIE);
  }
  return response;
}
