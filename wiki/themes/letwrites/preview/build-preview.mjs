#!/usr/bin/env node
/**
 * Build the BEFORE/AFTER preview of the Letwrites Notion reskin.
 *
 * Renders the SAME BookStack-representative markup twice:
 *   before.html — a faithful-enough approximation of stock BookStack chrome
 *   after.html  — the markup with the REAL reskin CSS pulled from ../branding.css
 *                 (so the preview can never drift from what actually ships)
 *   index.html  — both, side by side, in iframes (open this)
 *
 * Re-run after editing branding.css:  node preview/build-preview.mjs
 * (Pure preview tooling — never served to users, not part of the theme runtime.)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = join(HERE, '..');

// 1) Pull the real reskin CSS (the whole <style> block inner content) from branding.css.
const branding = readFileSync(join(THEME, 'branding.css'), 'utf8');
const m = branding.match(/<style>([\s\S]*?)<\/style>/);
if (!m) { console.error('could not find <style> block in branding.css'); process.exit(1); }
const RESKIN_CSS = m[1];

// 2) BookStack-representative markup (v26.05 structural classes). Shared by both variants.
const MARKUP = `
<header id="header">
  <div class="header-inner">
    <a href="#" class="logo"><span class="logo-text">Letwrites</span></a>
    <div id="header-search"><input type="text" placeholder="Search the wiki..."></div>
    <nav class="header-links"><div class="links">
      <a href="#">Shelves</a><a href="#">Books</a><a href="#">Settings</a><a href="#">Profile</a>
    </div></nav>
  </div>
</header>

<section class="pagewrap">
  <h2 class="demo-label">Page view — book tree sidebar + content</h2>
  <div class="tri-layout-container">
    <aside class="tri-layout-left"><div class="tri-layout-left-contents">
      <h5>ENGINEERING HANDBOOK</h5>
      <div class="book-tree"><ul class="sidebar-page-list">
        <li class="entity-list-item"><span class="entity-list-item-name">Getting started</span></li>
        <li class="entity-list-item selected"><span class="entity-list-item-name">Deploy runbook</span></li>
        <li class="entity-list-item"><span class="entity-list-item-name">Incident response</span></li>
        <li class="entity-list-item"><span class="entity-list-item-name">On-call rotation</span></li>
      </ul></div>
    </div></aside>
    <main class="tri-layout-middle"><div class="tri-layout-middle-contents">
      <nav class="breadcrumbs"><a href="#">Engineering Handbook</a> / <a href="#">Operations</a> / Deploy runbook</nav>
      <div class="page-content">
        <h1>Deploy runbook</h1>
        <p>This guide covers the standard production deploy. Agents publishing here are permission-checked and audited &mdash; the same rules a person sees.</p>
        <h2>Prerequisites</h2>
        <ul><li>Access to the <code>prod</code> environment</li><li>A green CI build on <code>main</code></li></ul>
        <blockquote>Never deploy on a Friday afternoon unless rolling back a Sev-1.</blockquote>
        <h2>Environments</h2>
        <table><thead><tr><th>Environment</th><th>URL</th><th>Owner</th></tr></thead>
        <tbody>
          <tr><td>Staging</td><td>stg.internal</td><td>Platform</td></tr>
          <tr><td>Production</td><td>app.internal</td><td>SRE</td></tr>
        </tbody></table>
        <p><a href="#">Related: incident response &rarr;</a></p>
        <div class="actions">
          <button class="button primary">Edit page</button>
          <button class="button">Export</button>
          <button class="button">Revisions</button>
        </div>
      </div>
    </div></main>
    <aside class="tri-layout-right"><div class="tri-layout-right-contents">
      <h5>PAGE INFO</h5>
      <p class="faded">Updated 2 days ago by Alice</p>
      <p class="faded">4 revisions</p>
    </div></aside>
  </div>

  <h2 class="demo-label">Shelf / books grid</h2>
  <div class="content-wrap">
    <div class="grid">
      <div class="grid-card"><h4 class="entity-list-item-name"><a href="#">Engineering Handbook</a></h4><p class="entity-item-snippet">Runbooks, architecture, on-call.</p></div>
      <div class="grid-card"><h4 class="entity-list-item-name"><a href="#">People Ops</a></h4><p class="entity-item-snippet">Policies, benefits, onboarding.</p></div>
      <div class="grid-card"><h4 class="entity-list-item-name"><a href="#">Security</a></h4><p class="entity-item-snippet">Standards, reviews, incident log.</p></div>
    </div>
  </div>

  <h2 class="demo-label">Settings (admin)</h2>
  <div class="content-wrap settings-container">
    <nav class="setting-nav">
      <a href="#" class="active">Features &amp; Security</a>
      <a href="#">Customization</a>
      <a href="#">Registration</a>
      <a href="#">Users</a>
      <a href="#">Roles</a>
    </nav>
    <div class="setting-list">
      <div class="form-group">
        <label>Application name</label>
        <input type="text" value="Letwrites">
      </div>
      <div class="form-group">
        <label>Allow public access</label>
        <select><option>No</option><option>Yes</option></select>
      </div>
      <div class="actions"><button class="button primary">Save settings</button></div>
    </div>
  </div>

  <h2 class="demo-label">Login</h2>
  <div class="login-wrap">
    <div class="card login-form">
      <h3>Log in</h3>
      <div class="form-group"><label>Email</label><input type="email" placeholder="you@company.com"></div>
      <div class="form-group"><label>Password</label><input type="password" placeholder="********"></div>
      <button class="button primary" style="width:100%">Log in</button>
    </div>
  </div>
</section>`;

// 3) A faithful-enough approximation of STOCK BookStack chrome (the "before").
const BEFORE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;font-family:'Lato','Helvetica Neue',Arial,sans-serif;color:#444;background:#f2f2f2;font-size:14px;line-height:1.6}
#header{background:#0288d1;color:#fff}
.header-inner{display:flex;align-items:center;gap:18px;max-width:1100px;margin:0 auto;padding:0 16px;height:56px}
.logo-text{color:#fff;font-weight:700;font-size:18px}
#header-search input{border:0;border-radius:3px;padding:6px 10px;width:220px}
.header-links .links{display:flex;gap:16px;margin-left:auto}
#header a{color:#fff;text-decoration:none;font-size:14px}
.pagewrap{max-width:1100px;margin:0 auto;padding:18px 16px 60px}
.demo-label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:34px 0 10px;border-bottom:1px solid #ddd;padding-bottom:6px}
.tri-layout-container{display:grid;grid-template-columns:240px 1fr 220px;gap:18px;background:#fff;border:1px solid #ddd;border-radius:3px}
.tri-layout-left{background:#f8f8f8;border-right:1px solid #ddd}
.tri-layout-left-contents,.tri-layout-middle-contents,.tri-layout-right-contents{padding:16px}
h5{font-size:11px;letter-spacing:.06em;color:#888;margin:0 0 10px}
.sidebar-page-list{list-style:none;margin:0;padding:0}
.entity-list-item{padding:6px 8px;font-size:14px;color:#206ea7;cursor:pointer}
.entity-list-item.selected{background:#e3f2fb;font-weight:700}
.breadcrumbs{font-size:12px;color:#888;margin-bottom:14px}
.breadcrumbs a{color:#206ea7;text-decoration:none}
.page-content h1{font-size:26px;color:#222;font-weight:400;margin:.2em 0 .4em}
.page-content h2{font-size:19px;color:#222;font-weight:400;border-bottom:1px solid #eee;padding-bottom:4px}
.page-content a{color:#206ea7}
.page-content code{background:#f2f2f2;border:1px solid #ddd;padding:1px 4px;border-radius:2px}
.page-content blockquote{border-left:4px solid #ddd;color:#777;margin-left:0;padding-left:12px}
table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border:1px solid #ccc;padding:8px 10px;text-align:left}
th{background:#eee}
.actions{margin-top:18px;display:flex;gap:8px}
.button{background:#0288d1;color:#fff;border:1px solid #0277bd;border-radius:3px;padding:8px 14px;font-size:13px;cursor:pointer;text-transform:uppercase;letter-spacing:.03em}
.button.primary{background:#0288d1}
.button:not(.primary){background:#fff;color:#444;border:1px solid #ccc}
.content-wrap{background:#fff;border:1px solid #ddd;border-radius:3px;padding:16px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.grid-card{border:1px solid #ddd;border-radius:3px;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.grid-card h4{margin:0 0 6px} .grid-card a{color:#206ea7;text-decoration:none}
.entity-item-snippet{color:#888;font-size:13px}
.settings-container{display:grid;grid-template-columns:220px 1fr;gap:18px}
.setting-nav{display:flex;flex-direction:column;gap:2px}
.setting-nav a{padding:8px 10px;color:#206ea7;text-decoration:none;font-size:14px}
.setting-nav a.active{background:#e3f2fb;font-weight:700}
.form-group{margin-bottom:14px}
label{display:block;font-size:13px;color:#555;margin-bottom:4px}
input,select{width:100%;border:1px solid #ccc;border-radius:3px;padding:7px 9px;font-size:14px}
.login-wrap{display:flex;justify-content:center;margin-top:8px}
.card.login-form{background:#fff;border:1px solid #ddd;border-radius:3px;padding:24px;width:340px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.faded{color:#999;font-size:13px}
`;

const page = (title, css, body, banner) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${css}</style></head>
<body>${banner ? `<div style="background:${banner.bg};color:${banner.fg};font:600 13px/1 Inter,sans-serif;padding:8px 14px;text-align:center">${banner.text}</div>` : ''}${body}</body></html>`;

mkdirSync(HERE, { recursive: true });

// AFTER: the real reskin CSS. branding.css sets background/colour on <body> + structural classes,
// so it applies to this markup exactly as it will to BookStack's DOM.
writeFileSync(join(HERE, 'after.html'), page('Letwrites — Notion reskin (AFTER)', RESKIN_CSS + '\n.pagewrap{max-width:1100px;margin:0 auto;padding:18px 16px 60px}.demo-label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--lw-text-muted);margin:34px 0 10px;border-bottom:1px solid var(--lw-border);padding-bottom:6px}.header-inner{display:flex;align-items:center;gap:18px;max-width:1100px;margin:0 auto;padding:0 16px;height:56px}#header-search input{width:240px}.header-links .links{display:flex;gap:16px;margin-left:auto}.tri-layout-container{display:grid;grid-template-columns:240px 1fr 200px;gap:40px;align-items:start}.tri-layout-left{background:var(--lw-sidebar);border-radius:var(--lw-radius-lg)}.tri-layout-left-contents{padding:16px 14px}.tri-layout-middle-contents{padding:8px 0}.tri-layout-right-contents{padding:8px 0}.sidebar-page-list{list-style:none;margin:0;padding:0}.entity-list-item{padding:6px 8px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px}.settings-container{display:grid;grid-template-columns:220px 1fr;gap:48px;max-width:980px}.setting-nav{display:flex;flex-direction:column;gap:2px}.setting-nav a{padding:8px 12px;text-decoration:none}.setting-list{max-width:520px}.login-wrap{display:flex;justify-content:center;margin-top:8px}.card.login-form{padding:36px 32px;width:380px;border:1px solid var(--lw-border) !important;border-radius:14px !important;box-shadow:0 4px 24px rgba(15,15,15,.06) !important}.card.login-form h3{font-size:1.4rem;margin:0 0 22px}.actions{margin-top:18px;display:flex;gap:8px}h5{font-size:11px;letter-spacing:.06em;color:var(--lw-text-muted);margin:0 0 10px}', MARKUP, { bg: '#37352f', fg: '#fff', text: 'AFTER — Letwrites Notion reskin (real branding.css applied)' }));

writeFileSync(join(HERE, 'before.html'), page('Letwrites — stock BookStack (BEFORE)', BEFORE_CSS, MARKUP, { bg: '#0288d1', fg: '#fff', text: 'BEFORE — stock BookStack chrome (approximation)' }));

const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Letwrites Notion reskin — before / after</title>
<style>
  :root{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:#0b0d11;color:#e7ebf0}
  .bar{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid #222833}
  .bar b{font-size:15px;letter-spacing:-.01em}
  .bar .muted{color:#98a2b1;font-size:13px}
  .toggle{margin-left:auto;display:flex;gap:6px;background:#13171e;border:1px solid #222833;border-radius:9px;padding:4px}
  .toggle button{border:0;background:transparent;color:#98a2b1;font:600 13px/1 inherit;padding:7px 14px;border-radius:6px;cursor:pointer}
  .toggle button.on{background:#2f6bff;color:#fff}
  .stage{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#222833;height:calc(100vh - 50px)}
  .stage.solo{grid-template-columns:1fr}
  .pane{display:flex;flex-direction:column;background:#fff;min-width:0}
  .pane.hide{display:none}
  .pane .cap{font:600 12px/1 Inter,sans-serif;color:#fff;padding:7px 12px;text-align:center}
  .pane.b .cap{background:#0288d1} .pane.a .cap{background:#37352f}
  iframe{border:0;width:100%;flex:1;background:#fff}
</style></head>
<body>
  <div class="bar">
    <b>Letwrites · Notion reskin</b><span class="muted">before / after — same markup, real theme CSS</span>
    <div class="toggle">
      <button data-v="split" class="on">Split</button>
      <button data-v="before">Before</button>
      <button data-v="after">After</button>
    </div>
  </div>
  <div class="stage" id="stage">
    <div class="pane b" id="paneB"><div class="cap">BEFORE — stock BookStack</div><iframe src="before.html"></iframe></div>
    <div class="pane a" id="paneA"><div class="cap">AFTER — Notion reskin</div><iframe src="after.html"></iframe></div>
  </div>
  <script>
    var stage=document.getElementById('stage'),B=document.getElementById('paneB'),A=document.getElementById('paneA');
    document.querySelectorAll('.toggle button').forEach(function(btn){
      btn.addEventListener('click',function(){
        document.querySelectorAll('.toggle button').forEach(function(b){b.classList.remove('on');});
        btn.classList.add('on');var v=btn.dataset.v;
        stage.classList.toggle('solo',v!=='split');
        B.classList.toggle('hide',v==='after');
        A.classList.toggle('hide',v==='before');
      });
    });
  </script>
</body></html>`;
writeFileSync(join(HERE, 'index.html'), index);

console.log('preview written: before.html, after.html, index.html (open index.html)');
