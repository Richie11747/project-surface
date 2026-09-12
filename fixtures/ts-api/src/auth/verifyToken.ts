/** Request authentication. Intentionally undocumented, so doctor has something to find. */

export interface TokenClaims {
  subject: string;
  scopes: string[];
}

export function verifyToken(token: string): TokenClaims {
  const secret = process.env.AUTH_SIGNING_SECRET;
  if (!secret) throw new Error("AUTH_SIGNING_SECRET is not configured.");
  if (!token.startsWith(`${secret}.`)) throw new Error("Invalid token.");

  const [, subject, scopes = ""] = token.split(".");
  return { subject: subject ?? "", scopes: scopes.split(",").filter(Boolean) };
}
