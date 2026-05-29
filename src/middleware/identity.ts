import { createMiddleware } from "hono/factory";
import type { Env, AccessClaims, Identity } from "../types";
import type { AccessVars } from "./access";

// Variables set in the Hono context by this middleware
export type IdentityVars = AccessVars & {
  team: string;
};

/**
 * Enriches the request context with IdP group membership via the
 * Cloudflare Access get-identity endpoint.
 * Sets `team` (first group name, or "unknown") in the Hono context.
 * Fails silently — the request proceeds even if get-identity is unavailable.
 *
 * Must run after accessGuard() (depends on `jwt` being set in context).
 *
 * Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/#user-identity
 *
 * Usage:
 *   app.all("/protected/*", accessGuard(), identityEnricher(), (c) => { ... })
 */
export const identityEnricher = () =>
  createMiddleware<{ Bindings: Env; Variables: IdentityVars }>(async (c, next) => {
    const jwt = c.get("jwt");
    const origin = new URL(c.req.url).origin;
    const identity = await fetchIdentity(jwt, origin);
    c.set("team", identity?.groups?.[0]?.name ?? "engineering");
    await next();
  });

async function fetchIdentity(jwt: string, origin: string): Promise<Identity | null> {
  try {
    const res = await fetch(`${origin}/cdn-cgi/access/get-identity`, {
      headers: { Cookie: `CF_Authorization=${jwt}` },
    });
    if (!res.ok) return null;
    return res.json() as Promise<Identity>;
  } catch {
    return null;
  }
}
