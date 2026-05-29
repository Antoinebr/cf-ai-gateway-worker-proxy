import { createMiddleware } from "hono/factory";
import { jwtVerify, createRemoteJWKSet } from "jose";
import type { Env, AccessClaims } from "../types";

// Variables set in the Hono context by this middleware
export type AccessVars = {
  claims: AccessClaims;
  jwt: string;
};

/**
 * Verifies the Cloudflare Access JWT on every inbound request.
 * On success, sets `claims` (email + sub) and `jwt` in the Hono context.
 * On failure, returns 401 and short-circuits the handler chain.
 *
 * Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 *
 * Usage:
 *   app.all("/protected/*", accessGuard(), (c) => { ... })
 */
export const accessGuard = () =>
  createMiddleware<{ Bindings: Env; Variables: AccessVars }>(async (c, next) => {
    // Access injects Cf-Access-Jwt-Assertion on every request that passes the policy.
    // OpenCode also forwards cf-access-token (set in provider headers via the discovery doc).
    const token =
      c.req.raw.headers.get("Cf-Access-Jwt-Assertion") ??
      c.req.raw.headers.get("cf-access-token");

    if (!token) {
      return c.json(
        { error: "Unauthorized", detail: "missing Access JWT — request did not pass through Cloudflare Access" },
        401
      );
    }

    const JWKS = createRemoteJWKSet(
      new URL(`https://${c.env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`)
    );

    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: `https://${c.env.ACCESS_TEAM}.cloudflareaccess.com`,
        audience: c.env.ACCESS_AUD,
      });

      const email = payload["email"] as string | undefined;
      const sub = payload["sub"] as string | undefined;

      if (!email || !sub) {
        throw new Error("Access JWT is missing email or sub claim");
      }

      c.set("claims", { email, sub });
      c.set("jwt", token);
    } catch (err) {
      return c.json(
        { error: "Unauthorized", detail: (err as Error).message },
        401
      );
    }

    await next();
  });
