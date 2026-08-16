import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizationCodeGrant } from "openid-client";
import { getOidcConfiguration, getEditorEmails, persistSession, OIDC_TRANSACTION_COOKIE, SESSION_COOKIE, fetchUserInfo } from "@/lib/auth";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const rawTransaction = cookieStore.get(OIDC_TRANSACTION_COOKIE)?.value;
  if (!rawTransaction) return NextResponse.json({ ok: false, code: "AUTH_TRANSACTION_MISSING" }, { status: 400 });
  try {
    const transaction = JSON.parse(rawTransaction) as { state: string; nonce: string; codeVerifier: string; redirectUri: string };
    const configuration = await getOidcConfiguration(transaction.redirectUri);
    const tokens = await authorizationCodeGrant(configuration, new URL(request.url), {
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      pkceCodeVerifier: transaction.codeVerifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub || !tokens.access_token) throw new Error("AUTH_CLAIMS_MISSING");
    const userInfo = await fetchUserInfo(configuration, tokens.access_token, claims.sub);
    const email = typeof userInfo.email === "string" ? userInfo.email.toLowerCase() : "";
    if (!email || userInfo.email_verified !== true || !getEditorEmails().has(email)) throw new Error("FORBIDDEN");
    const token = await persistSession(claims.sub, email);
    const response = NextResponse.redirect(new URL("/zh-CN/admin", request.url));
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    response.cookies.delete(OIDC_TRANSACTION_COOKIE);
    return response;
  } catch (error) {
    const code = error instanceof Error && ["FORBIDDEN", "AUTH_CLAIMS_MISSING"].includes(error.message) ? error.message : "AUTH_CALLBACK_FAILED";
    return NextResponse.json({ ok: false, code, message: code === "FORBIDDEN" ? "当前账号没有赛事管理权限" : "登录回调失败，请重试" }, { status: code === "FORBIDDEN" ? 403 : 400 });
  }
}
