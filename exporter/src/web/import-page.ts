/**
 * The standalone self-service import page — one self-contained HTML document (no external assets, so
 * it works behind your domain and a strict CSP). It composes the SHARED import UI (import-ui.ts) so
 * the in-wiki page (/letwrites/import, which loads /import/ui.js) and this page never drift.
 */
import { IMPORT_UI_STYLE, IMPORT_UI_MARKUP, IMPORT_UI_SCRIPT } from './import-ui.js';

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Letwrites — Import your Confluence content</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0b1220;background:#f6f8fc;padding:0 0 60px}
  /* Header matches the Letwrites website: dark bar, the L mark in a white rounded tile, white wordmark. */
  header{background:#0b1220;padding:14px 24px;display:flex;align-items:center;gap:12px}
  header .logo{width:34px;height:34px;border-radius:9px;background:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  header .logo img{width:24px;height:24px;display:block}
  header b{font-size:18px;letter-spacing:-.02em;color:#fff;font-weight:700}
  header .muted{color:#9aa6b8;font-size:13px}
  .page{max-width:760px;margin:28px auto;padding:0 20px}
${IMPORT_UI_STYLE}
</style>
</head>
<body>
<header><span class="logo"><img src="/import/logo.png" alt="Letwrites" /></span><b>Letwrites</b> <span class="muted">·&nbsp; Import from Confluence</span></header>
<div class="page">
${IMPORT_UI_MARKUP}
</div>
<script>
${IMPORT_UI_SCRIPT}
</script>
</body>
</html>`;
