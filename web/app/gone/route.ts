import type { Metadata } from "next";
import type { NextRequest } from "next/server";

/**
 * Real HTTP 410 for unlisted slugs, rewritten here by the proxy (A11, PRD
 * 5.1.4). Self-contained on-brand HTML: no layout, inline styles, noindex,
 * localized from the ?locale= the proxy supplies.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "zh" ? "zh" : "en";
  const messages = (await import(`../../messages/${locale}.json`)).default as {
    empty: { goneTitle: string; goneBody: string; backHome: string; browseAll: string };
    site: { name: string; zhName: string };
  };

  const html = `<!DOCTYPE html>
<html lang="${locale === "zh" ? "zh-Hans" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>${messages.empty.goneTitle} · ${messages.site.name}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; background: #f5f1e8; color: #1b1a17; }
  @media (prefers-color-scheme: dark) { body { background: #13120e; color: #f2ede2; } }
  .card { max-width: 560px; width: 100%; text-align: center; padding: 56px 24px; border: 1px solid #e3ddd0; border-radius: 16px; background: #fbf9f4; }
  @media (prefers-color-scheme: dark) { .card { border-color: #2e2b24; background: #1c1a15; } }
  h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 24px 0 8px; }
  p { margin: 0 0 24px; color: #6b665c; font-size: 15px; }
  @media (prefers-color-scheme: dark) { p { color: #a39c8e; } }
  .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  a { display: inline-flex; align-items: center; height: 44px; padding: 0 20px; border: 1px solid #e3ddd0; border-radius: 12px; color: inherit; text-decoration: none; font-size: 14px; }
  a:hover { border-color: #1b1a17; }
  @media (prefers-color-scheme: dark) { a { border-color: #2e2b24; } a:hover { border-color: #f2ede2; } }
  a:focus-visible { outline: 2px solid #ff5b1f; outline-offset: 3px; }
  .dot { color: #ff5b1f; font-weight: 700; }
</style>
</head>
<body>
  <main class="card">
    <div aria-hidden="true"><span class="dot">●</span>—<span style="opacity:.4">—</span><span style="opacity:.4">—</span>—○</div>
    <h1>${messages.empty.goneTitle}</h1>
    <p>${messages.empty.goneBody}</p>
    <div class="actions">
      <a href="/${locale}">${messages.empty.backHome}</a>
      <a href="/${locale}/games">${messages.empty.browseAll}</a>
    </div>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=30" },
  });
}
