/**
 * Detects the AI coding client from the HTTP User-Agent header and returns
 * a short, normalized name suitable for use in cf-aig-metadata (max 5 keys,
 * string values only).
 *
 * Patterns are tested in order — first match wins.
 * Returns "unknown" when no known client is detected.
 */

const KNOWN_CLIENTS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /opencode/i,         name: "opencode" },
  { pattern: /cursor/i,           name: "cursor" },
  { pattern: /claude[-_]?code/i,  name: "claude-code" },
  { pattern: /windsurf/i,         name: "windsurf" },
  { pattern: /copilot/i,          name: "copilot" },
  { pattern: /continue/i,         name: "continue" },
  { pattern: /aider/i,            name: "aider" },
  { pattern: /cline/i,            name: "cline" },
];

export function detectClient(userAgent: string | null | undefined): string {
  if (!userAgent) return "unknown";
  for (const { pattern, name } of KNOWN_CLIENTS) {
    if (pattern.test(userAgent)) return name;
  }
  return "unknown";
}
