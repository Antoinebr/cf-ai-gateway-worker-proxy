export type Env = {
  // Non-sensitive vars (wrangler.jsonc → vars)
  ACCESS_TEAM: string; // e.g. "antoinebr" → antoinebr.cloudflareaccess.com
  ACCT_ID: string;     // Cloudflare Account ID
  GW_ID: string;       // AI Gateway ID

  // Secrets (wrangler secret put)
  AIG_TOKEN: string;   // Authenticated AI Gateway token → cf-aig-authorization
  ACCESS_AUD: string;  // Access Application Audience (AUD) tag

  // Workers AI native binding (wrangler.jsonc → ai)
  AI: Ai;
};

export type AccessClaims = {
  email: string;
  sub: string;
};

export type Identity = {
  name: string;
  groups: Array<{ id: string; name: string }>;
};
