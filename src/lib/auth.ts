import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import {
  ClientSecretPost,
  calculatePKCECodeChallenge,
  customFetch,
  discovery,
  fetchUserInfo,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type CustomFetch,
  type Configuration,
} from "openid-client";
import { adminSessions } from "../../db/schema";
import { getDb } from "./db";

export const SESSION_COOKIE = "vct_session";
export const OIDC_TRANSACTION_COOKIE = "vct_oidc_transaction";

export interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
}

export function getEditorEmails(): Set<string> {
  return new Set((process.env.VCT_EDITOR_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

export function getRedirectUri(origin?: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? origin ?? "http://localhost:3000").replace(/\/$/, "")}/api/auth/callback`;
}

function fingerprint(value: string | undefined): string | undefined {
  return value === undefined ? undefined : createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function getPresentedClientId(options: Parameters<CustomFetch>[1]): { basic?: string; form?: string; bodyKeys: string[] } {
  let basic: string | undefined;
  const authorization = getHeader(options.headers, "authorization");
  if (authorization?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator > 0) basic = decoded.slice(0, separator);
    } catch {
      // The diagnostic intentionally ignores malformed credentials.
    }
  }

  let form: string | undefined;
  const body = options.body;
  if (body instanceof URLSearchParams) {
    form = body.get("client_id") ?? undefined;
  } else if (typeof body === "string") {
    form = new URLSearchParams(body).get("client_id") ?? undefined;
  }

  const bodyKeys = body instanceof URLSearchParams
    ? [...body.keys()].sort()
    : typeof body === "string"
      ? [...new URLSearchParams(body).keys()].sort()
      : [];
  return { basic, form, bodyKeys };
}

function createDevelopmentOidcFetch(clientId: string): CustomFetch {
  return async (url, options) => {
    if (new URL(url).pathname.endsWith("/api/oidc/token")) {
      const presented = getPresentedClientId(options);
      console.error("[auth.oidc.request] " + JSON.stringify({
        endpoint: "token",
        configuredClientIdFingerprint: fingerprint(clientId),
        basicClientIdFingerprint: fingerprint(presented.basic),
        formClientIdFingerprint: fingerprint(presented.form),
        bodyKeys: presented.bodyKeys,
      }));
    }
    return globalThis.fetch(url, options as RequestInit);
  };
}

export async function getOidcConfiguration(redirectUri: string): Promise<Configuration> {
  const issuer = process.env.LSCUBE_OIDC_ISSUER;
  const clientId = process.env.LSCUBE_OIDC_CLIENT_ID;
  const clientSecret = process.env.LSCUBE_OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) throw new Error("OIDC_NOT_CONFIGURED");
  const configuration = await discovery(
    new URL(issuer),
    clientId,
    { redirect_uris: [redirectUri], response_types: ["code"], token_endpoint_auth_method: "client_secret_post" },
    ClientSecretPost(clientSecret),
  );
  if (process.env.NODE_ENV !== "production") configuration[customFetch] = createDevelopmentOidcFetch(clientId);
  return configuration;
}

export async function createOidcTransaction(redirectUri: string): Promise<OidcTransaction> {
  const codeVerifier = randomPKCECodeVerifier();
  return { state: randomState(), nonce: randomNonce(), codeVerifier, redirectUri };
}

export async function getAuthorizationParameters(transaction: OidcTransaction) {
  return {
    redirect_uri: transaction.redirectUri,
    scope: "openid profile email",
    code_challenge: await calculatePKCECodeChallenge(transaction.codeVerifier),
    code_challenge_method: "S256",
    state: transaction.state,
    nonce: transaction.nonce,
  };
}

export function hashSessionToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET_NOT_CONFIGURED");
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function persistSession(subject: string, email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const db = getDb();
  await db.insert(adminSessions).values({
    tokenHash: hashSessionToken(token),
    subject,
    email,
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
  });
  return token;
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const db = getDb();
    const rows = await db.select().from(adminSessions).where(eq(adminSessions.tokenHash, hashSessionToken(token))).limit(1);
    const session = rows[0];
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("UNAUTHORIZED");
  if (!getEditorEmails().has(session.email.toLowerCase())) throw new Error("FORBIDDEN");
  return session;
}

export async function revokeSession(token: string): Promise<void> {
  const db = getDb();
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashSessionToken(token)));
}

export { fetchUserInfo };
