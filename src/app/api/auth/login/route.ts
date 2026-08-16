import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "openid-client";
import { getAuthorizationParameters, getOidcConfiguration, createOidcTransaction, OIDC_TRANSACTION_COOKIE, getRedirectUri } from "@/lib/auth";

type LoginStage = "transaction" | "discovery" | "authorization_url";

function redactErrorMessage(message: string): string {
  return message
    .replace(/([?&\s](?:code|access_token|id_token|client_secret|code_verifier|state|nonce)=)[^&\s]*/gi, "$1[redacted]")
    .slice(0, 240);
}

function classifyLoginError(stage: LoginStage, error: unknown): { code: string; status: number; message: string } {
  const rawMessage = error instanceof Error ? error.message : "";
  if (rawMessage === "OIDC_NOT_CONFIGURED") {
    return { code: "OIDC_NOT_CONFIGURED", status: 503, message: "登录服务尚未完成配置，请联系管理员" };
  }

  const byStage: Record<LoginStage, { code: string; status: number; message: string }> = {
    transaction: { code: "AUTH_TRANSACTION_FAILED", status: 503, message: "无法创建登录请求，请稍后重试" },
    discovery: { code: "OIDC_DISCOVERY_FAILED", status: 503, message: "无法连接登录服务，请检查 issuer 地址或网络" },
    authorization_url: { code: "OIDC_AUTHORIZATION_URL_FAILED", status: 503, message: "登录服务配置无效，请联系管理员" },
  };
  return byStage[stage];
}

export async function GET(request: Request) {
  let stage: LoginStage = "transaction";
  try {
    const redirectUri = getRedirectUri(new URL(request.url).origin);
    const transaction = await createOidcTransaction(redirectUri);

    stage = "discovery";
    const configuration = await getOidcConfiguration(redirectUri);

    stage = "authorization_url";
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
    unstable_rethrow(error);
    const classified = classifyLoginError(stage, error);
    console.error("[auth.login] " + JSON.stringify({
      stage,
      code: classified.code,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? redactErrorMessage(error.message) : "Unknown error",
    }));
    return NextResponse.json({ ok: false, code: classified.code, message: classified.message }, { status: classified.status });
  }
}
