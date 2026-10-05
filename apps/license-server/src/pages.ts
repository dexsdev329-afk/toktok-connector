const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Small static page shown after Stripe redirects (no script, no external resource). */
export function page(title: string, text: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(title)} — TokTok Game Connector Live</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b14;color:#e8e8f0;font-family:system-ui,sans-serif}
main{max-width:480px;padding:32px;border-radius:18px;background:#14141f;border:1px solid #2a2a3d;text-align:center}
h1{font-size:22px;margin:0 0 12px}p{color:#a8a8bd;line-height:1.5}b{color:#ff2d75}
</style></head>
<body><main><h1>${escape(title)}</h1><p>${escape(text)}</p><p><b>TokTok</b> Game Connector Live</p></main></body></html>`;
}
