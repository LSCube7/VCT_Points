import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { authorizationCodeGrant } from "openid-client";
import {
  fetchUserInfo,
  getEditorEmails,
  getOidcConfiguration,
  OIDC_TRANSACTION_COOKIE,
  persistSession,
  SESSION_COOKIE,
} from "@/lib/auth";

type CallbackStage = "transaction" | "discovery" | "token_exchange" | "claims" | "userinfo" | "authorization" | "session";

const stageCodes: Record<Exclude<CallbackStage, "transaction" | "claims" | "authorization">, string> = {
  discovery: "OIDC_DISCOVERY_FAILED",
  token_exchange: "OIDC_TOKEN_EXCHANGE_FAILED",
  userinfo: "OIDC_USERINFO_FAILED",
  session: "SESSION_PERSIST_FAILED",
};

function redactErrorMessage(message: string): string {
  return message
    .replace(/([?&\s](?:code|access_token|id_token|client_secret|code_verifier|state|nonce)=)[^&\s]*/gi, "$1[redacted]")
    .slice(0, 240);
}

function getErrorField(error: unknown, field: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function classifyCallbackError(stage: CallbackStage, error: unknown): { code: string; status: number; message: string } {
  const rawMessage = error instanceof Error ? error.message : "";
  const oauthError = getErrorField(error, "error");
  const oauthCode = getErrorField(error, "code");
  const oauthDescription = getErrorField(error, "error_description") ?? "";

  if (rawMessage === "FORBIDDEN") {
    return { code: "FORBIDDEN", status: 403, message: "当前账号没有赛事管理权限" };
  }
  if (rawMessage === "AUTH_CLAIMS_MISSING") {
    return { code: "AUTH_CLAIMS_MISSING", status: 400, message: "登录服务没有返回完整的账号信息，请联系管理员" };
  }
  if (rawMessage === "OIDC_NOT_CONFIGURED") {
    return { code: "OIDC_NOT_CONFIGURED", status: 503, message: "登录服务尚未完成配置，请联系管理员" };
  }
  if (rawMessage === "SESSION_SECRET_NOT_CONFIGURED") {
    return { code: "SESSION_SECRET_NOT_CONFIGURED", status: 503, message: "服务端会话密钥尚未配置，请联系管理员" };
  }
  if (rawMessage === "DATABASE_NOT_CONFIGURED") {
    return { code: "DATABASE_NOT_CONFIGURED", status: 503, message: "服务端数据库尚未连接，请联系管理员" };
  }

  if (stage === "token_exchange") {
    if (oauthError === "invalid_client") {
      return { code: "OIDC_CLIENT_AUTH_FAILED", status: 503, message: "OAuth 客户端认证失败，请检查客户端密钥" };
    }
    if (oauthError === "invalid_grant") {
      if (/client\s+id\s+mismatch/i.test(oauthDescription)) {
        return { code: "OIDC_CLIENT_ID_MISMATCH", status: 400, message: "当前登录服务与授权页面使用的客户端配置不一致，请重启应用后从登录入口重新登录" };
      }
      return { code: "OIDC_INVALID_GRANT", status: 400, message: "授权码已失效或校验不匹配，请从登录入口重新开始" };
    }
    if (oauthCode === "OAUTH_INVALID_RESPONSE" && /state/i.test(rawMessage)) {
      return { code: "OIDC_STATE_MISMATCH", status: 400, message: "登录会话已过期或打开了多个登录页面，请重新登录" };
    }
    if (oauthCode === "OAUTH_RESPONSE_BODY_ERROR") {
      return { code: "OIDC_TOKEN_ENDPOINT_REJECTED", status: 400, message: "OAuth 服务拒绝了授权码，请重新登录或联系管理员" };
    }
    if (oauthCode === "OAUTH_INVALID_RESPONSE" && /jwt|id[_ -]?token|nonce|issuer|signature|audience/i.test(rawMessage)) {
      return { code: "OIDC_ID_TOKEN_INVALID", status: 502, message: "OAuth 服务返回的身份令牌无法校验，请联系管理员" };
    }
  }

  const code = stageCodes[stage as keyof typeof stageCodes] ?? "AUTH_CALLBACK_FAILED";
  const messageByCode: Record<string, string> = {
    OIDC_DISCOVERY_FAILED: "无法读取登录服务配置，请检查 issuer 地址",
    OIDC_TOKEN_EXCHANGE_FAILED: "登录授权码兑换失败，请检查回调地址和客户端配置",
    OIDC_USERINFO_FAILED: "无法读取登录账号信息，请检查登录服务配置",
    SESSION_PERSIST_FAILED: "登录成功但无法保存会话，请检查数据库配置",
    AUTH_CALLBACK_FAILED: "登录回调失败，请重试",
  };
  return { code, status: 400, message: messageByCode[code] };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const rawTransaction = cookieStore.get(OIDC_TRANSACTION_COOKIE)?.value;
  if (!rawTransaction) return NextResponse.json({ ok: false, code: "AUTH_TRANSACTION_MISSING" }, { status: 400 });

  let stage: CallbackStage = "transaction";
  try {
    const transaction = JSON.parse(rawTransaction) as { state: string; nonce: string; codeVerifier: string; redirectUri: string };

    stage = "discovery";
    const configuration = await getOidcConfiguration(transaction.redirectUri);

    stage = "token_exchange";
    const tokens = await authorizationCodeGrant(configuration, new URL(request.url), {
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      pkceCodeVerifier: transaction.codeVerifier,
      idTokenExpected: true,
    });

    stage = "claims";
    const claims = tokens.claims();
    if (!claims?.sub || !tokens.access_token) throw new Error("AUTH_CLAIMS_MISSING");

    stage = "userinfo";
    const userInfo = await fetchUserInfo(configuration, tokens.access_token, claims.sub);
    const email = typeof userInfo.email === "string" ? userInfo.email.toLowerCase() : "";

    stage = "authorization";
    if (!email || userInfo.email_verified !== true || !getEditorEmails().has(email)) throw new Error("FORBIDDEN");

    stage = "session";
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
    unstable_rethrow(error);
    const classified = classifyCallbackError(stage, error);
    console.error("[auth.callback] " + JSON.stringify({
      stage,
      code: classified.code,
      errorName: error instanceof Error ? error.name : "UnknownError",
      oauthCode: getErrorField(error, "code"),
      oauthError: getErrorField(error, "error"),
      oauthStatus: getErrorField(error, "status"),
      oauthDescription: redactErrorMessage(getErrorField(error, "error_description") ?? ""),
      errorMessage: error instanceof Error ? redactErrorMessage(error.message) : "Unknown error",
    }));
    return NextResponse.json({ ok: false, code: classified.code, message: classified.message }, { status: classified.status });
  }
}
