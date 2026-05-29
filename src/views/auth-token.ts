/**
 * Renders the authentication success page shown at GET /auth/token.
 * Auto-copies the JWT to the clipboard on page load so the OpenCode
 * clipboard-polling auth command captures it immediately.
 * The token is hidden by default — a "Show token" disclosure reveals it.
 */
export function tokenPage(email: string, jwt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>OpenCode — Authenticated</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f0f17;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .card {
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      padding: 2.5rem 2rem;
      max-width: 480px;
      width: 100%;
      text-align: center;
    }

    .icon {
      width: 48px;
      height: 48px;
      background: #1e3a2f;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.25rem;
      font-size: 1.4rem;
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 0.4rem;
    }

    .email {
      font-size: 0.875rem;
      color: #8888aa;
      margin-bottom: 1.75rem;
    }

    .status {
      font-size: 0.9rem;
      color: #a0a0c0;
      line-height: 1.5;
      margin-bottom: 1.5rem;
      min-height: 2.5rem;
    }

    .status.copied { color: #4ade80; }
    .status.error  { color: #f87171; }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: #4f46e5;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 0.6rem 1.25rem;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:hover  { background: #4338ca; }
    .btn:active { background: #3730a3; }

    details {
      margin-top: 1.5rem;
      text-align: left;
    }

    summary {
      font-size: 0.8rem;
      color: #6666aa;
      cursor: pointer;
      user-select: none;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      justify-content: center;
    }
    summary::-webkit-details-marker { display: none; }
    summary::before {
      content: "▸";
      transition: transform 0.15s;
      display: inline-block;
    }
    details[open] summary::before { transform: rotate(90deg); }

    .token-box {
      margin-top: 0.75rem;
      background: #0f0f17;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 0.75rem;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 0.72rem;
      color: #8888aa;
      word-break: break-all;
      line-height: 1.5;
      max-height: 120px;
      overflow-y: auto;
    }

    .divider {
      border: none;
      border-top: 1px solid #2a2a4a;
      margin: 1.5rem 0 0;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Authenticated</h1>
    <p class="email">${email}</p>
    <p class="status" id="status">Copying token to clipboard…</p>
    <button class="btn" onclick="copyToken()">Copy to clipboard</button>
    <details>
      <summary>Show token</summary>
      <div class="token-box">${jwt}</div>
    </details>
    <hr class="divider">
  </div>

  <script>
    const TOKEN = ${JSON.stringify(jwt)};
    const status = document.getElementById("status");

    function setStatus(msg, cls) {
      status.textContent = msg;
      status.className = "status " + (cls ?? "");
    }

    function copyToken() {
      navigator.clipboard.writeText(TOKEN)
        .then(() => setStatus("Token copied! Return to your terminal.", "copied"))
        .catch(() => setStatus("Could not auto-copy. Use the token below.", "error"));
    }

    // Auto-copy on page load
    window.addEventListener("load", () => {
      if (navigator.clipboard) {
        copyToken();
      } else {
        setStatus("Auto-copy not available. Click the button below.", "error");
      }
    });
  </script>
</body>
</html>`;
}
