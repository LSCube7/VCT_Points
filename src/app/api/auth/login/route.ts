import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "openid-client";
import { getAuthorizationParameters, getOidcConfiguration, createOidcTransaction, OIDC_TRANSACTION_COOKIE, getRedirectUri } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const redirectUri = getRedirectUri(new URL(request.url).origin);
    const transaction = await createOidcTransaction(redirectUri);
    const configuration = await getOidcConfiguration(redirectUri);
    const authorizationUrl = buildAuthorizationUrl(configuration, await getAuthorizationParameters(transaction));
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(OIDC_TRANSACTION_COOKIE, JSON.stringify(transaction), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error && error.message === "OIDC_NOT_CONFIGURED" ? "OIDC_NOT_CONFIGURED" : "AUTH_LOGIN_FAILED";
    return NextResponse.json({ ok: false, code: message, message: "登录服务暂未配置，请联系管理员" }, { status: 503 });
  }
}

