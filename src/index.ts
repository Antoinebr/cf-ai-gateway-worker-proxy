import { Hono } from "hono";
import type { Env } from "./types";
import { accessGuard } from "./middleware/access";
import { identityEnricher } from "./middleware/identity";
import { tokenPage } from "./views/auth-token";
import { detectClient } from "./utils/detect-client";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /.well-known/opencode
// Public discovery endpoint — OpenCode reads this on `opencode auth login <url>`.
// Served without Access enforcement (Access Bypass app covers this path).
// Reference: https://opencode.ai/docs/config/#opencode-url
// ---------------------------------------------------------------------------

app.get("/.well-known/opencode", (c) => {
  const base = new URL(c.req.url).origin;

  return c.json({
    auth: {
      // Opens /auth/token in the browser (behind Access), polls clipboard for the JWT.
      // macOS: pbpaste | Linux: xsel -bo / xclip -o
      command: [
        "sh",
        "-c",
        `open "${base}/auth/token" 2>/dev/null || xdg-open "${base}/auth/token" 2>/dev/null; printf '\\n→ Authenticate in the browser, then COPY the token shown.\\n' >&2; while true; do T=$(pbpaste 2>/dev/null || xsel -bo 2>/dev/null || xclip -selection clipboard -o 2>/dev/null || echo ""); if [ "\${T#eyJ}" != "$T" ] && [ \${#T} -gt 100 ]; then printf '%s' "$T"; break; fi; sleep 1; done`,
      ],
      env: "TOKEN",
    },
    config: {
      provider: {
        "anthropic": {
          options: {
            baseURL: `${base}/anthropic/v1`,
            apiKey: "",
            headers: { "cf-access-token": "{env:TOKEN}" },
          },
        },
        "openai": {
          options: {
            baseURL: `${base}/openai/v1`,
            apiKey: "",
            headers: { "cf-access-token": "{env:TOKEN}" },
          },
        },
        "workers-ai: Cloudflare AI Gateway": {
          models: {
            "@cf/moonshotai/kimi-k2.6": {
              name: "Kimi K2.6",
              tool_call: true,
              reasoning: true,
              attachment: true,
              cost: { input: 0.95, output: 4.0 },
              limit: { context: 262144, output: 32000 },
            },
            "@cf/zai-org/glm-4.7-flash": {
              name: "GLM 4.7 Flash",
              tool_call: true,
              reasoning: true,
              cost: { input: 0.06, output: 0.4 },
              limit: { context: 131072, output: 32000 },
            },
            "@cf/openai/gpt-oss-120b": {
              name: "GPT-OSS 120B",
              tool_call: true,
              reasoning: true,
              cost: { input: 0.35, output: 0.75 },
              limit: { context: 128000, output: 32000 },
            },
            "@cf/google/gemma-4-26b-a4b-it": {
              name: "Gemma 4 26B",
              tool_call: true,
              reasoning: true,
              attachment: true,
              cost: { input: 0.1, output: 0.3 },
              limit: { context: 256000, output: 32000 },
            },
          },
          options: {
            baseURL: `${base}/workers-ai/v1`,
            apiKey: "",
            headers: { "cf-access-token": "{env:TOKEN}" },
          },
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /auth/token
// Behind Access — returns a styled HTML page that auto-copies the JWT to
// clipboard. Used by the auth command in the discovery doc above.
// ---------------------------------------------------------------------------

app.get("/auth/token", (c) => {
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) return c.text("Not authenticated. Authenticate via Cloudflare Access first.", 401);

  let email = "unknown";
  try {
    // JWT payload is base64url-encoded — decode to extract email.
    // Access already verified the signature before forwarding the request.
    email = JSON.parse(atob(jwt.split(".")[1])).email ?? "unknown";
  } catch { /* ignore malformed payload */ }

  return c.html(tokenPage(email, jwt));
});

// ---------------------------------------------------------------------------
// ALL /:provider/*
// Proxy to AI Gateway — protected by Access JWT verification and enriched
// with IdP group membership for per-team attribution in Gateway logs.
// Supported providers: anthropic | openai | workers-ai
// ---------------------------------------------------------------------------

app.all("/:provider/*", accessGuard(), identityEnricher(), async (c) => {
  const { email, sub } = c.get("claims");
  const team = c.get("team") || "engineering";
  const provider = c.req.param("provider");

  // Build upstream AI Gateway URL
  // Pattern: https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/<provider><tail>
  const tail = c.req.path.replace(`/${provider}`, "");
  const upstream = `https://gateway.ai.cloudflare.com/v1/${c.env.ACCT_ID}/${c.env.GW_ID}/${provider}${tail}`;

  // Rewrite headers
  const headers = new Headers(c.req.raw.headers);

  // Strip client-side headers — never forwarded to the upstream provider
  headers.delete("authorization");
  headers.delete("cf-access-token");
  headers.delete("Cf-Access-Jwt-Assertion");
  headers.delete("host");

  // AI Gateway authentication
  // Reference: https://developers.cloudflare.com/ai-gateway/get-started/connecting-applications/#authenticated-gateway
  headers.set("cf-aig-authorization", `Bearer ${c.env.AIG_TOKEN}`);

  // Per-request metadata for cost attribution (max 5 keys, string/number/boolean)
  // Reference: https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/
  const client = detectClient(c.req.header("user-agent"));
  headers.set("cf-aig-metadata", JSON.stringify({ user: email, sub, team, client }));

  // Provider API keys are managed via AI Gateway BYOK — not stored in this Worker.

  const response = await fetch(upstream, {
    method: c.req.method,
    headers,
    body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
  });

  // Rebuild response — strip hop-by-hop headers that break SSE streaming
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
});

export default app;
