/**
 * The import UI as ONE source, used two ways:
 *   1. The standalone page (import-page.ts) wraps it in a full HTML document.
 *   2. The in-wiki page (theme route /letwrites/import) loads it as a mountable asset from
 *      /import/ui.js, so the UI renders inside native BookStack chrome with zero duplication.
 *
 * All widget styles are scoped under #lw-import-root so embedding into BookStack can't leak CSS.
 * Dynamic values (book names, logs, the integrity report) are written via textContent, never
 * innerHTML — the only innerHTML write is this static markup, which contains no user data.
 */

// Scoped widget styles. The standalone page adds its own page-chrome (body/header) on top.
export const IMPORT_UI_STYLE = `
  #lw-import-root{--brand:#2f6bff;--ink:#0b1220;--muted:#5b6678;--line:#e6e9f0;--panel:#fff;--ok:#0f9d58;--bad:#dc2626;--radius:12px;color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  #lw-import-root *{box-sizing:border-box}
  #lw-import-root .wrap{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
  #lw-import-root h1{font-size:23px;letter-spacing:-.02em;margin:0}
  #lw-import-root .sub{color:var(--muted);margin-top:6px;font-size:14.5px}
  #lw-import-root .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px}
  #lw-import-root .card h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 14px}
  #lw-import-root label{display:block;font-size:13px;font-weight:600;margin:10px 0 5px}
  #lw-import-root input,#lw-import-root select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;font:inherit;background:#fff;color:var(--ink)}
  #lw-import-root input:focus,#lw-import-root select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(47,107,255,.12)}
  #lw-import-root .row{display:flex;gap:12px}#lw-import-root .row>div{flex:1}
  #lw-import-root button{background:var(--brand);color:#fff;font-weight:600;border:0;border-radius:9px;padding:11px 18px;font-size:15px;cursor:pointer;margin-top:14px}
  #lw-import-root button:disabled{opacity:.5;cursor:not-allowed}
  #lw-import-root button.link{background:none;color:var(--brand);border:1px solid var(--line);margin-right:8px}
  #lw-import-root button.link:hover{border-color:var(--brand)}
  #lw-import-root .muted{color:var(--muted);font-size:13px}#lw-import-root .hint{margin-top:6px}
  #lw-import-root .note{font-size:13px;color:var(--muted);background:#eef3ff;border:1px solid #d9e4ff;border-radius:9px;padding:11px 13px;margin-top:12px}
  #lw-import-root #status{font-size:13.5px;margin-top:10px}
  #lw-import-root .ok{color:var(--ok)}#lw-import-root .bad{color:var(--bad)}
  #lw-import-root #status.run{color:var(--brand)}
  #lw-import-root #status.run::before{content:"";display:inline-block;width:13px;height:13px;margin-right:8px;border:2px solid #c7d2fe;border-top-color:var(--brand);border-radius:50%;animation:lwspin .8s linear infinite;vertical-align:-2px}
  @keyframes lwspin{to{transform:rotate(360deg)}}
  #lw-import-root pre{white-space:pre-wrap;word-break:break-word;background:#0c0f14;color:#cdd6e4;border-radius:10px;padding:14px 16px;font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:12px;max-height:480px;overflow:auto}
  #lw-import-root .step.off{opacity:.5;pointer-events:none}
  #lw-import-root a{color:var(--brand)}
  #lw-import-root #visbox{margin-top:12px;border-top:1px solid var(--line);padding-top:12px}
  #lw-import-root #visbox>label:first-child{font-size:13px;font-weight:600;color:var(--ink)}
  #lw-import-root .vr{display:block;font-weight:400;margin:7px 0;cursor:pointer}
  #lw-import-root .vr input{width:auto;margin-right:8px}
  #lw-import-root #roles{margin-top:6px;min-height:96px}`;

// The widget markup. Static — no interpolation, no user data.
export const IMPORT_UI_MARKUP = `<div id="lw-import-root"><div class="wrap">
  <div>
    <h1>Bring your Confluence content in</h1>
    <p class="sub">Upload your Confluence space export and choose where it lands. It imports with <b>your</b> account's permissions, into a space you can write to — so you don't need an admin. Your data goes straight to your own wiki; nothing is uploaded to us.</p>
  </div>

  <div class="card" id="step1">
    <h2>1 · Connect to your wiki</h2>
    <label for="base">Your Letwrites/BookStack URL</label>
    <input id="base" type="url" placeholder="https://docs.yourcompany.com" autocomplete="off" />
    <div class="row">
      <div><label for="tid">API Token ID</label><input id="tid" type="text" autocomplete="off" /></div>
      <div><label for="tsec">API Token Secret</label><input id="tsec" type="password" autocomplete="off" /></div>
    </div>
    <p class="hint muted">The token carries your own permissions, so the import only touches what you can. Need one?</p>
    <button id="gettoken" type="button" class="link">Get an API token →</button>
    <button id="connect" type="button">Connect</button>
    <div id="status1"></div>
  </div>

  <div class="card step off" id="step2">
    <h2>2 · Choose who it's for</h2>
    <label for="dest">Import into</label>
    <select id="dest"><option value="new">A new top-level book (needs "Create Books" permission)</option></select>
    <div id="visbox">
      <label>Who can see the imported content?</label>
      <label class="vr"><input type="radio" name="lwvis" value="everyone" /> Everyone who can reach the space</label>
      <label class="vr"><input type="radio" name="lwvis" value="only-me" /> Only me (grant groups afterwards)</label>
      <label class="vr"><input type="radio" name="lwvis" value="groups" id="visgroups" /> Only specific groups</label>
      <select id="roles" multiple style="display:none"></select>
      <p id="rolesnote" class="muted hint"></p>
    </div>
    <p id="destnote" class="note" style="display:none">It imports into the chosen book and inherits that book's visibility.</p>
  </div>

  <div class="card step off" id="step3">
    <h2>3 · Upload &amp; import</h2>
    <label for="file">Confluence export (.zip) — "Export space → HTML"</label>
    <input id="file" type="file" accept=".zip,application/zip" />
    <button id="go" type="button" disabled>Import</button>
    <div id="status"></div>
    <pre id="report" style="display:none"></pre>
  </div>
</div></div>`;

// The wiring logic. Plain string so it can be embedded inline (standalone page) or served as JS
// (in-wiki asset). NOTE: keep "\\n" double-escaped — it must emit a backslash-n in the output JS.
export const IMPORT_UI_SCRIPT = `
  var $=function(s){return document.querySelector(s);};
  // "Only me" visibility = deny-all with no role grant; it only works for admins (they bypass content
  // permissions). A non-admin who picked it would lock themselves out of their own import — so the
  // in-wiki page sets LW_IS_ADMIN=false for non-admins and we hide that option (Everyone / groups stay).
  if(window.LW_IS_ADMIN===false){var _om=document.querySelector('input[name=lwvis][value=only-me]');if(_om&&_om.parentNode&&_om.parentNode.style)_om.parentNode.style.display='none';}
  // When embedded in the wiki, the host page knows its own domain (origin) and the signed-in user,
  // so it sets LW_IMPORT_BASE (and LW_TOKEN_URL). Prefill + HIDE the URL field — the domain is
  // auto-detected, no need to retype it. The standalone page leaves these unset and shows the field.
  if(window.LW_IMPORT_BASE && $('#base')){
    $('#base').value=window.LW_IMPORT_BASE;
    $('#base').style.display='none';
    var bl=document.querySelector('label[for=base]'); if(bl)bl.style.display='none';
  }
  function headers(){return {'x-bookstack-base':$('#base').value.trim(),'x-bookstack-token-id':$('#tid').value.trim(),'x-bookstack-token-secret':$('#tsec').value.trim()};}
  function setStatus(el,msg,cls){el.textContent=msg;el.className=cls||'';}

  // Open the user's own BookStack API-tokens page so they can create a token (no auto-minting —
  // the token stays the user's, scoped to their permissions).
  $('#gettoken').addEventListener('click',function(){
    // In-wiki, the host page provides the exact token-create URL for this user — use it directly.
    if(window.LW_TOKEN_URL){window.open(window.LW_TOKEN_URL,'_blank','noopener');return;}
    var base=$('#base').value.trim();
    while(base.length && base.charAt(base.length-1)==='/') base=base.slice(0,-1);
    var lower=base.toLowerCase();
    if(lower.indexOf('http://')!==0 && lower.indexOf('https://')!==0){setStatus($('#status1'),'Enter your wiki URL above first (https://…), then click again.','bad');$('#base').focus();return;}
    // Standalone: the user is logged into their wiki in this same browser, so send them to their
    // own account's Access & Security page (API tokens live there → "Create Token"). The exact path
    // varies by BookStack version, so it's configurable via LETWRITES_TOKEN_PATH (default below).
    window.open(base+(window.LW_TOKEN_PATH||'/my-account/auth'),'_blank','noopener');
  });

  $('#connect').addEventListener('click',function(){
    var s=$('#status1');setStatus(s,'Connecting…');
    fetch('/import/api/destinations',{method:'POST',headers:headers()}).then(function(r){return r.json();}).then(function(d){
      if(!d.ok){setStatus(s,d.error||'Could not connect.','bad');return;}
      var sel=$('#dest');
      // keep the "new book" option, then add existing books as audience destinations
      (d.books||[]).forEach(function(b){var o=document.createElement('option');o.value=String(b.id);o.textContent='Import into: '+b.name;sel.appendChild(o);});
      setStatus(s,'Connected. '+ (d.books||[]).length +' existing space(s) found.','ok');
      $('#step2').classList.remove('off');$('#step3').classList.remove('off');
      loadRoles(); refreshVisUI(); refreshGo();
    }).catch(function(){setStatus(s,'Could not reach the server.','bad');});
  });

  // ── Who can see the imported content? (forced choice; never silently public) ────────────────
  // Fetch the user's groups so "Only specific groups" can populate. Needs a token that can manage
  // roles (admin/IT migrator); a plain token soft-fails → that option is disabled with a note.
  function loadRoles(){
    var sel=$('#roles'), gr=$('#visgroups'), note=$('#rolesnote');
    // In-wiki (broker-backed): the page hands us the user's groups directly from their session, so the
    // group picker works even for a NON-admin whose API token cannot list roles.
    if(window.LW_SHARE_ENABLED && Object.prototype.toString.call(window.LW_GROUPS)==='[object Array]' && window.LW_GROUPS.length){
      window.LW_GROUPS.forEach(function(role){var o=document.createElement('option');o.value=String(role.id);o.textContent=role.name;sel.appendChild(o);});
      note.textContent=''; return;
    }
    fetch('/import/api/roles',{method:'POST',headers:headers()}).then(function(r){return r.json();}).then(function(d){
      if(d && d.ok && d.roles && d.roles.length){
        d.roles.forEach(function(role){var o=document.createElement('option');o.value=String(role.id);o.textContent=role.display_name;sel.appendChild(o);});
        note.textContent='';
      } else {
        gr.disabled=true; var lbl=gr.parentNode; if(lbl&&lbl.style)lbl.style.opacity='.5';
        note.textContent='Your token cannot list groups — choose Everyone or Only me, or use the in-wiki "Who can see this?" panel to grant a group afterwards.';
      }
    }).catch(function(){});
  }
  // Show the visibility radios only for a NEW top-level book; an existing book inherits its own perms.
  function refreshVisUI(){
    var isNew = $('#dest').value==='new';
    $('#visbox').style.display = isNew ? 'block' : 'none';
    $('#destnote').style.display = isNew ? 'none' : 'block';
    var g=document.querySelector('input[name=lwvis]:checked');
    $('#roles').style.display = (isNew && g && g.value==='groups') ? 'block' : 'none';
  }
  // The chosen visibility, or null if the user still must choose (forces the Import button off).
  function visChoice(){
    if($('#dest').value!=='new') return {mode:'inherit'};       // existing book → inherits; valid
    var r=document.querySelector('input[name=lwvis]:checked');
    if(!r) return null;                                          // nothing picked yet
    if(r.value==='groups'){
      var ids=Array.prototype.map.call($('#roles').selectedOptions,function(o){return o.value;});
      return ids.length ? {mode:'groups',roles:ids} : null;      // groups picked but none selected
    }
    return {mode:r.value};
  }
  function refreshGo(){ $('#go').disabled = !($('#file').files.length>0 && visChoice()!==null); }

  $('#dest').addEventListener('change',function(){refreshVisUI();refreshGo();});
  Array.prototype.forEach.call(document.querySelectorAll('input[name=lwvis]'),function(r){r.addEventListener('change',function(){refreshVisUI();refreshGo();});});
  $('#roles').addEventListener('change',refreshGo);
  $('#file').addEventListener('change',refreshGo);

  // The import runs in the BACKGROUND on the server. The upload must finish while this tab is open;
  // after that the import keeps running even if the tab closes. We poll a job id for live progress,
  // and persist it so reopening the page resumes the view.
  var pollTimer=null;
  function showRunning(msg){var s=$('#status');s.className='run';s.textContent=msg;}
  function clearJob(){try{localStorage.removeItem('lw_import_job');}catch(e){}}
  function getStoredVis(){try{var raw=localStorage.getItem('lw_import_job');if(raw){var j=JSON.parse(raw);return j&&j.vis;}}catch(e){}return null;}
  // Broker-backed visibility: restrict each created book via the session-authed share-apply route (the
  // importer's token couldn't). Fail-safe — a book we COULDN'T restrict is surfaced loudly, and the job
  // id is kept so reopening this page retries it (never silently left public).
  function applyBrokerVisibility(books,d){
    var vis=getStoredVis();
    if(!vis||!window.LW_SHARE_APPLY_URL){clearJob();renderResult(d);return;}
    var payloadVis=vis.mode==='only-me'?'only-me':'restricted';
    var groups=vis.mode==='groups'?vis.roles.map(Number):[];
    showRunning('Setting who can see the imported content…');
    var failures=[],i=0;
    function finish(){
      var rep=$('#report');rep.style.display='block';rep.textContent=d.report||'';
      var s=$('#status'),su=d.summary||{};
      if(failures.length){
        setStatus(s,'⚠️ Imported OK, but could NOT restrict '+failures.length+' of '+books.length+' book(s) — they may be visible to others. Open each and set "Who can see this?", or reopen this page to retry. ('+failures.join('; ')+')','bad');
      } else {
        setStatus(s,'Done: '+su.pages+' pages, '+su.imagesUploaded+' images. Visibility applied to '+books.length+' book(s). ✓','ok');
        clearJob();
      }
    }
    (function next(){
      if(i>=books.length){finish();return;}
      var b=books[i++];
      fetch(window.LW_SHARE_APPLY_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entityType:'book',entityId:b.id,visibility:payloadVis,groups:groups,level:'viewer'})})
        .then(function(r){return r.json().catch(function(){return {ok:false};});})
        .then(function(res){if(!res||!res.ok)failures.push(b.name);})
        .catch(function(){failures.push(b.name);})
        .then(function(){next();});
    })();
  }
  function renderResult(d){
    var s=$('#status');var rep=$('#report');
    if(d.status==='error'){setStatus(s,'Import failed: '+(d.error||'unknown error'),'bad');if(d.log&&d.log.length){rep.style.display='block';rep.textContent=d.log.join('\\n');}return;}
    var su=d.summary||{};
    setStatus(s,'Done: '+su.pages+' pages, '+su.chapters+' chapters'+(su.books?(', '+su.books+' books'):'')+', '+su.imagesUploaded+' images'+(su.imagesMissing?(' ('+su.imagesMissing+' missing)'):'')+'.','ok');
    rep.style.display='block';rep.textContent=d.report||'';
  }
  function pollJob(id){
    if(pollTimer)clearInterval(pollTimer);
    function tick(){
      fetch('/import/status?id='+encodeURIComponent(id)).then(function(r){return r.status===404?{gone:true}:r.json();}).then(function(d){
        if(!d)return;
        if(d.gone){clearInterval(pollTimer);pollTimer=null;clearJob();$('#go').disabled=false;setStatus($('#status'),'This import is no longer tracked (the service may have restarted). Check your wiki for the imported content.','bad');return;}
        if(d.status==='running'){showRunning(d.count?('Importing… '+d.count+' page'+(d.count===1?'':'s')+' done so far. You can close this tab — it keeps running.'):'Importing… starting up. You can close this tab — it keeps running.');return;}
        clearInterval(pollTimer);pollTimer=null;$('#go').disabled=false;
        // Deferred (broker) visibility: restrict the created books now, before clearing the job.
        if(d.status!=='error' && d.deferred && d.createdBooks && d.createdBooks.length){applyBrokerVisibility(d.createdBooks,d);}
        else{clearJob();renderResult(d);}
      }).catch(function(){/* transient blip — keep polling */});
    }
    tick();pollTimer=setInterval(tick,2500);
  }

  $('#go').addEventListener('click',function(){
    var f=$('#file').files[0];if(!f)return;
    var dest=$('#dest').value;var s=$('#status');$('#report').style.display='none';
    var vc=visChoice();if(vc===null){setStatus(s,'Choose who can see the imported content first.','bad');return;}
    // Broker mode (in-wiki): a restriction (only-me/groups) is applied via the session/broker AFTER
    // import, because the importer's own token can't set permissions. We tell the server to DEFER
    // (create the books, don't try to restrict with the token) and restrict them ourselves once done.
    var brokerMode = !!window.LW_SHARE_ENABLED && (vc.mode==='only-me' || vc.mode==='groups');
    var q='/import/run?dest='+encodeURIComponent(dest);
    if(brokerMode){q+='&vis=defer';}
    else if(vc.mode!=='inherit'){q+='&vis='+encodeURIComponent(vc.mode);if(vc.mode==='groups')q+='&roles='+encodeURIComponent(vc.roles.join(','));}
    $('#go').disabled=true;showRunning('Uploading… keep this tab open until the upload finishes.');
    fetch(q,{method:'POST',headers:headers(),body:f}).then(function(r){return r.json();}).then(function(d){
      if(!d||!d.ok||!d.jobId){$('#go').disabled=false;setStatus(s,'Import failed: '+((d&&d.error)||'could not start the import'),'bad');return;}
      // Persist the chosen visibility too, so reopening the page can (re)apply it via the broker.
      try{localStorage.setItem('lw_import_job',JSON.stringify({id:d.jobId,at:Date.now(),vis:brokerMode?vc:null}));}catch(e){}
      showRunning('Importing… you can close this tab now — it keeps running. Reopen this page to check progress.');
      pollJob(d.jobId);
    }).catch(function(){$('#go').disabled=false;setStatus(s,'Import failed: could not reach the server (the upload may have been interrupted).','bad');});
  });

  // Resume: if an import from an earlier visit is still tracked, show its progress again.
  (function(){
    var raw;try{raw=localStorage.getItem('lw_import_job');}catch(e){return;}
    if(!raw)return;
    var j;try{j=JSON.parse(raw);}catch(e){clearJob();return;}
    if(!j||!j.id||(Date.now()-(j.at||0))>6*60*60*1000){clearJob();return;}
    $('#step2').classList.remove('off');$('#step3').classList.remove('off');
    $('#go').disabled=true;showRunning('Checking your earlier import…');pollJob(j.id);
  })();`;

/**
 * The mountable asset served at /import/ui.js. It injects the scoped style, renders the static
 * markup into a host element (#lw-import-root if the host already provides one, else it creates one
 * and appends to <body> or a #lw-import-mount), then runs the wiring. Self-contained; safe to load
 * with <script src="/import/ui.js">.
 */
export const IMPORT_UI_ASSET_JS = `(function(){
  var style=document.createElement('style');style.textContent=${JSON.stringify(IMPORT_UI_STYLE)};document.head.appendChild(style);
  var host=document.getElementById('lw-import-mount')||document.body;
  var tmp=document.createElement('div');tmp.innerHTML=${JSON.stringify(IMPORT_UI_MARKUP)};
  host.appendChild(tmp.firstChild);
  ${IMPORT_UI_SCRIPT}
})();`;
