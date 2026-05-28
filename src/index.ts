import { Hono } from "hono";
import { jwtVerify, createRemoteJWKSet } from "jose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Env = {
  // Non-sensitive vars (wrangler.jsonc → vars)
  ACCESS_TEAM: string;   // e.g. "antoinebr" → antoinebr.cloudflareaccess.com
  ACCT_ID: string;       // Cloudflare Account ID
  GW_ID: string;         // AI Gateway ID

  // Secrets (wrangler secret put)
  AIG_TOKEN: string;     // Authenticated AI Gateway token  → cf-aig-authorization
  OPENAI_KEY: string;    // OpenAI API key
  ANTHROPIC_KEY: string; // Anthropic API key
  CF_API_TOKEN: string;  // Cloudflare API token with Workers AI permission
  ACCESS_AUD: string;    // Access Application Audience (AUD) tag

  // Workers AI native binding (wrangler.jsonc → ai)
  AI: Ai;
};

type AccessClaims = {
  email: string;
  sub: string;
};

// ---------------------------------------------------------------------------
// Access JWT verification
// Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/#cloudflare-workers-example
// ---------------------------------------------------------------------------

async function verifyAccess(req: Request, env: Env): Promise<AccessClaims> {
  // Access injects Cf-Access-Jwt-Assertion on every request that passes the policy.
  // The client also sends cf-access-token (set in provider headers by OpenCode).
  const token =
    req.headers.get("Cf-Access-Jwt-Assertion") ??
    req.headers.get("cf-access-token");

  if (!token) {
    throw new Error("missing Access JWT — request did not pass through Cloudflare Access");
  }

  const JWKS = createRemoteJWKSet(
    new URL(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`)
  );

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://${env.ACCESS_TEAM}.cloudflareaccess.com`,
    audience: env.ACCESS_AUD,
  });

  const email = payload["email"] as string | undefined;
  const sub = payload["sub"] as string | undefined;

  if (!email || !sub) {
    throw new Error("Access JWT is missing email or sub claim");
  }

  return { email, sub };
}

// ---------------------------------------------------------------------------
// Provider key resolution
// ---------------------------------------------------------------------------

function providerKey(provider: string, env: Env): string {
  switch (provider) {
    case "openai":
      return env.OPENAI_KEY;
    case "anthropic":
      return env.ANTHROPIC_KEY;
    case "workers-ai":
      // Workers AI uses a Cloudflare API token, not a third-party provider key
      return env.CF_API_TOKEN;
    default:
      throw new Error(`unknown provider: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /.well-known/opencode
// Discovery endpoint — OpenCode reads this on `opencode auth login <url>`
// Reference: https://opencode.ai/docs/config/#opencode-url
// ---------------------------------------------------------------------------

app.get("/.well-known/opencode", (c) => {
  const base = new URL(c.req.url).origin; // https://opencode.antoinee.xyz

  return c.json({
    // Auth block — tells OpenCode how to get a token for this server.
    // cloudflared stores the JWT and OpenCode picks it up via the TOKEN env var.
    auth: {
      command: [
        "cloudflared",
        "access",
        "login",
        "--no-verbose",
        `--app=${base}`,
      ],
      env: "TOKEN",
    },

    // Config block — merged into the OpenCode config (remote < project < local).
    // Reference: https://opencode.ai/docs/config/#precedence-order
    config: {
      provider: {
        anthropic: {
          options: {
            baseURL: `${base}/anthropic/v1`,
            apiKey: "", // injected server-side — never on the developer laptop
            headers: {
              "cf-access-token": "{env:TOKEN}", // Access JWT forwarded on every request
            },
          },
        },
        openai: {
          options: {
            baseURL: `${base}/openai/v1`,
            apiKey: "",
            headers: {
              "cf-access-token": "{env:TOKEN}",
            },
          },
        },
        "workers-ai": {
          // Workers AI exposes an OpenAI-compatible API through AI Gateway
          options: {
            baseURL: `${base}/workers-ai/v1`,
            apiKey: "",
            headers: {
              "cf-access-token": "{env:TOKEN}",
            },
          },
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// ALL /:provider/* — stateless proxy to AI Gateway
// Supported providers: openai | anthropic | workers-ai
// ---------------------------------------------------------------------------

app.all("/:provider/*", async (c) => {
  const provider = c.req.param("provider");

  // 1. Verify the Access JWT and extract identity (email + sub)
  let claims: AccessClaims;
  try {
    claims = await verifyAccess(c.req.raw, c.env);
  } catch (err) {
    return c.json(
      { error: "Unauthorized", detail: (err as Error).message },
      401
    );
  }

  // 2. Resolve provider API key — throws if provider is unknown
  let key: string;
  try {
    key = providerKey(provider, c.env);
  } catch {
    return c.json({ error: `provider "${provider}" is not configured` }, 404);
  }

  // 3. Build the upstream AI Gateway URL
  //    Pattern: https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/<provider><tail>
  const tail = c.req.path.replace(`/${provider}`, ""); // e.g. /v1/messages
  const upstream = `https://gateway.ai.cloudflare.com/v1/${c.env.ACCT_ID}/${c.env.GW_ID}/${provider}${tail}`;

  // 4. Rewrite headers
  const headers = new Headers(c.req.raw.headers);

  // Strip client-side headers — never forwarded to the upstream provider
  headers.delete("authorization");
  headers.delete("cf-access-token");
  headers.delete("Cf-Access-Jwt-Assertion");
  headers.delete("host");

  // AI Gateway authentication
  // Reference: https://developers.cloudflare.com/ai-gateway/get-started/connecting-applications/#authenticated-gateway
  headers.set("cf-aig-authorization", `Bearer ${c.env.AIG_TOKEN}`);

  // Per-request metadata for cost attribution and analytics (max 5 keys, string/number/boolean)
  // Reference: https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/
  headers.set(
    "cf-aig-metadata",
    JSON.stringify({
      user: claims.email,
      sub: claims.sub,
      client: "opencode",
    })
  );

  // Provider API key — injected server-side (BYOK), never stored on developer machines
  headers.set("Authorization", `Bearer ${key}`);

  // 5. Proxy to AI Gateway
  const response = await fetch(upstream, {
    method: c.req.method,
    headers,
    body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
  });

  return response;
});

export default app;
