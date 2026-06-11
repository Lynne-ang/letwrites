<?php
/**
 * Letwrites authz endpoint — BookStack logical theme (NO fork).
 * ------------------------------------------------------------------
 * BookStack loads this file at boot when APP_THEME=letwrites. We register a
 * single privileged API route the Letwrites control-plane engine calls to get the
 * authoritative answer to: "which of these resources can this user read?"
 *
 * Why a theme and not a fork: BookStack's theme system is a supported extension
 * point with full access to the app's models and permission logic, and it
 * survives BookStack upgrades. No core edits, no merge debt.
 *
 *   Engine ──POST /letwrites/can-read──▶ BookStack (this route)
 *           { userId, resourceIds:["page:12","book:3"] }
 *           ◀── { allowed:["page:12"] }   (uses BookStack's OWN permission scope)
 *
 * SECURITY: this endpoint returns permission truth for ANY user, so it is a
 * privileged internal API. It is guarded by a shared secret (LETWRITES_AUTHZ_SECRET)
 * and should only be reachable from the engine on the internal network — never
 * exposed publicly.
 *
 * VERIFIED LIVE (2026-06-09, BookStack v26.05): the User lookup and the
 * `visible()` permission scope both resolve and enforce correctly — proven by
 * importing a real space and confirming a restricted page is returned to an admin
 * but withheld from a non-admin via this exact endpoint. If you run a much newer
 * BookStack and the namespaces below ever move, re-run wiki/deploy/verify-live.sh.
 */

use Illuminate\Support\Facades\Route;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

// Map a resource-type prefix to its BookStack Eloquent model. (verified: BookStack v26.05)
$letwritesModels = [
    'page'    => \BookStack\Entities\Models\Page::class,
    'book'    => \BookStack\Entities\Models\Book::class,
    'chapter' => \BookStack\Entities\Models\Chapter::class,
    'shelf'   => \BookStack\Entities\Models\Bookshelf::class,
];

// Register routes WITHOUT BookStack's 'api' middleware (which requires a BookStack
// API token) or 'web' (which enforces CSRF). Our shared-secret header guard is the
// only gate — so the engine can call /letwrites/can-read with just X-Letwrites-Secret.
(function () use ($letwritesModels) {

    // Liveness probe (no secret needed) — lets the engine confirm the theme loaded.
    Route::get('/letwrites/health', function (): JsonResponse {
        return response()->json(['ok' => true, 'service' => 'letwrites-authz', 'version' => 1]);
    });

    // The authoritative bulk permission check.
    Route::post('/letwrites/can-read', function (Request $request) use ($letwritesModels): JsonResponse {
        // 1. Guard: constant-time shared-secret check.
        $expected = (string) env('LETWRITES_AUTHZ_SECRET', '');
        $provided = (string) $request->header('X-Letwrites-Secret', '');
        if ($expected === '' || !hash_equals($expected, $provided)) {
            return response()->json(['error' => 'unauthorized'], 401);
        }

        // 2. Validate input.
        $userId = $request->input('userId');
        $resourceIds = $request->input('resourceIds', []);
        if (!is_numeric($userId) || !is_array($resourceIds)) {
            return response()->json(['error' => 'expected {userId:int, resourceIds:string[]}'], 422);
        }

        // 3. Resolve the user. (namespace verified against BookStack v26.05)
        $user = \BookStack\Users\Models\User::find((int) $userId);
        if ($user === null) {
            // Unknown user => can read nothing. Fail CLOSED.
            return response()->json(['allowed' => []]);
        }

        // 4. Make permission scopes resolve as THIS user, then check each resource
        //    using BookStack's own `visible()` permission scope. (verified against v26.05)
        //    If the row is visible to this user, it's allowed; otherwise denied.
        auth()->setUser($user);

        $allowed = [];
        foreach ($resourceIds as $rid) {
            if (!is_string($rid) || !str_contains($rid, ':')) {
                continue; // skip malformed ids rather than failing the whole batch
            }
            [$type, $id] = explode(':', $rid, 2);
            $modelClass = $letwritesModels[$type] ?? null;
            if ($modelClass === null || !ctype_digit($id)) {
                continue;
            }
            try {
                $row = $modelClass::visible()->find((int) $id);
                if ($row !== null) {
                    $allowed[] = $rid;
                }
            } catch (\Throwable $e) {
                // On ANY error, deny this resource (fail closed) — never leak on doubt.
                continue;
            }
        }

        return response()->json(['allowed' => $allowed]);
    });

    // The authoritative WRITE permission check (for governed write-back). Mirrors can-read:
    // resolve the user, then ask BookStack's OWN permission system whether they may create a page
    // in the target book/chapter (or update an existing page). Fail CLOSED on anything unexpected.
    //
    // VERIFY-ON-LIVE: the can-read route above is confirmed on BookStack v26.05; this route uses
    // the same User lookup + the `userCan()` helper + `visible()` scope. Re-run verify-live.sh
    // against your version to confirm `userCan('page-create'|'page-update', ...)` resolves.
    Route::post('/letwrites/can-write', function (Request $request) use ($letwritesModels): JsonResponse {
        $expected = (string) env('LETWRITES_AUTHZ_SECRET', '');
        $provided = (string) $request->header('X-Letwrites-Secret', '');
        if ($expected === '' || !hash_equals($expected, $provided)) {
            return response()->json(['error' => 'unauthorized'], 401);
        }

        $userId = $request->input('userId');
        $bookId = $request->input('bookId');
        $chapterId = $request->input('chapterId');
        $pageId = $request->input('pageId');
        if (!is_numeric($userId) || !is_numeric($bookId)) {
            return response()->json(['error' => 'expected {userId:int, bookId:int, chapterId?:int, pageId?:int}'], 422);
        }

        $user = \BookStack\Users\Models\User::find((int) $userId);
        if ($user === null) {
            return response()->json(['allowed' => false]); // unknown user ⇒ deny (fail closed)
        }
        auth()->setUser($user);

        $allowed = false;
        try {
            if (is_numeric($pageId)) {
                // Updating an existing page: it must be visible to the user AND updatable by them.
                $page = \BookStack\Entities\Models\Page::visible()->find((int) $pageId);
                $allowed = $page !== null && userCan('page-update', $page);
            } else {
                // Creating a new page: the user must be able to create within the container.
                $container = is_numeric($chapterId)
                    ? \BookStack\Entities\Models\Chapter::visible()->find((int) $chapterId)
                    : \BookStack\Entities\Models\Book::visible()->find((int) $bookId);
                $allowed = $container !== null && userCan('page-create', $container);
            }
        } catch (\Throwable $e) {
            $allowed = false; // never grant a write on doubt
        }

        return response()->json(['allowed' => (bool) $allowed]);
    });

    // can-MANAGE: may this user change WHO CAN SEE an entity (page/book/chapter/shelf)? This is the
    // authorization the paid share broker re-checks before it sets visibility on the user's behalf
    // (it never trusts the client's claim). Uses BookStack's own `restrictions-manage` ability, so a
    // regular user only passes for content they're actually allowed to manage. Fail CLOSED.
    //
    // VERIFY-ON-LIVE: model namespaces confirmed against BookStack v26.05; `restrictions-manage` is
    // BookStack's ability for editing an entity's permissions. Re-run verify-live.sh on your version.
    Route::post('/letwrites/can-manage', function (Request $request): JsonResponse {
        $expected = (string) env('LETWRITES_AUTHZ_SECRET', '');
        $provided = (string) $request->header('X-Letwrites-Secret', '');
        if ($expected === '' || !hash_equals($expected, $provided)) {
            return response()->json(['error' => 'unauthorized'], 401);
        }

        $userId = $request->input('userId');
        $type = (string) $request->input('entityType');
        $entityId = $request->input('entityId');
        if (!is_numeric($userId) || !is_numeric($entityId)) {
            return response()->json(['error' => 'expected {userId:int, entityType:string, entityId:int}'], 422);
        }

        $models = [
            'page' => \BookStack\Entities\Models\Page::class,
            'book' => \BookStack\Entities\Models\Book::class,
            'chapter' => \BookStack\Entities\Models\Chapter::class,
            'bookshelf' => \BookStack\Entities\Models\Bookshelf::class,
        ];
        if (!isset($models[$type])) {
            return response()->json(['allowed' => false]); // unknown type ⇒ deny
        }

        $user = \BookStack\Users\Models\User::find((int) $userId);
        if ($user === null) {
            return response()->json(['allowed' => false]); // unknown user ⇒ deny (fail closed)
        }
        auth()->setUser($user);

        $allowed = false;
        try {
            $entity = $models[$type]::visible()->find((int) $entityId);
            $allowed = $entity !== null && userCan('restrictions-manage', $entity);
        } catch (\Throwable $e) {
            $allowed = false; // never grant management on doubt
        }

        return response()->json(['allowed' => (bool) $allowed]);
    });
})();

/**
 * Owner self-service sharing (M3) — SESSION-authed browser routes. UNLIKE the secret-gated
 * server-to-server routes above, these run under BookStack's 'web' middleware (session + CSRF) and
 * are called by the logged-in user's browser. The theme mints the broker assertion for the SESSION
 * user (the browser never sees LETWRITES_SHARE_SECRET or the assertion) and proxies to the broker,
 * which independently re-checks can-manage. Default OFF.
 *
 * VERIFY-ON-LIVE: confirm web-middleware attachment + the CSRF token flow (the injected JS sends the
 * <meta name="token"> value as X-CSRF-TOKEN) on your BookStack version. Not run-tested off-box.
 */
(function () {
    $selfServiceOn = static fn (): bool => filter_var((string) env('LETWRITES_SELF_SERVICE', 'off'), FILTER_VALIDATE_BOOLEAN);

    // Mint a broker assertion for the session user. The canonical signed-string + encoding lives in
    // lib/assertion.php (unit-tested against the shared contract vector, so it can't silently drift
    // from the Node verifier). Here we just supply the live expiry + a fresh nonce.
    require_once __DIR__ . '/lib/assertion.php';
    $mint = static function (string $secret, $userId, string $action, string $entityType, int $entityId, int $ttl = 120): string {
        return letwrites_mint_assertion($secret, $userId, $action, $entityType, $entityId, time() + $ttl, bin2hex(random_bytes(12)));
    };

    $models = [
        'page' => \BookStack\Entities\Models\Page::class,
        'book' => \BookStack\Entities\Models\Book::class,
        'chapter' => \BookStack\Entities\Models\Chapter::class,
        'bookshelf' => \BookStack\Entities\Models\Bookshelf::class,
    ];

    Route::middleware('web')->group(function () use ($selfServiceOn, $mint, $models) {

        // Groups the owner can choose from (excludes the admin + public system roles). Powers the picker.
        Route::post('/letwrites/share-context', function (Request $request) use ($selfServiceOn): JsonResponse {
            if (!auth()->check() || !$selfServiceOn()) {
                return response()->json(['enabled' => false], 200);
            }
            $roles = \BookStack\Users\Models\Role::query()
                ->whereNotIn('system_name', ['admin', 'public'])
                ->orderBy('display_name')->get(['id', 'display_name']);
            return response()->json([
                'enabled' => true,
                // "Only me" (deny-all, no role grant) only works for admins — BookStack bypasses content
                // permissions for them. A non-admin who picks it locks themselves out of their own
                // content, so the UI offers it to admins only.
                'isAdmin' => auth()->user()->roles()->where('system_name', 'admin')->exists(),
                'groups' => $roles->map(fn ($r) => ['id' => $r->id, 'name' => (string) $r->display_name])->values(),
            ]);
        });

        // Resolve a wiki URL path to its entity (so the panel knows what it is acting on, without
        // scraping the DOM). visible()-scoped — a user can only resolve content they can see.
        Route::post('/letwrites/resolve-entity', function (Request $request) use ($models): JsonResponse {
            if (!auth()->check()) {
                return response()->json(['found' => false], 200);
            }
            $path = trim((string) $request->input('path', ''), '/');
            $seg = explode('/', $path);
            $lookup = function (string $type, ?string $slug, ?int $bookId = null) use ($models) {
                if ($slug === null || $slug === '') return null;
                $q = $models[$type]::visible()->where('slug', $slug);
                if ($bookId !== null) $q->where('book_id', $bookId);
                return $q->first();
            };
            try {
                $entity = null; $type = null;
                if (($seg[0] ?? '') === 'shelves') { $type = 'bookshelf'; $entity = $lookup('bookshelf', $seg[1] ?? null); }
                elseif (($seg[0] ?? '') === 'books') {
                    $book = $lookup('book', $seg[1] ?? null);
                    if ($book && ($seg[2] ?? '') === 'page') { $type = 'page'; $entity = $lookup('page', $seg[3] ?? null, $book->id); }
                    elseif ($book && ($seg[2] ?? '') === 'chapter') { $type = 'chapter'; $entity = $lookup('chapter', $seg[3] ?? null, $book->id); }
                    else { $type = 'book'; $entity = $book; }
                }
                if (!$entity) return response()->json(['found' => false], 200);
                return response()->json(['found' => true, 'entityType' => $type, 'entityId' => $entity->id, 'name' => (string) $entity->name]);
            } catch (\Throwable $e) {
                return response()->json(['found' => false], 200);
            }
        });

        // Apply a visibility change: mint for the SESSION user + proxy to the broker (which re-checks
        // can-manage). The browser never sees the secret or the assertion. Fail-closed.
        Route::post('/letwrites/share-apply', function (Request $request) use ($selfServiceOn, $mint): JsonResponse {
            if (!auth()->check()) return response()->json(['ok' => false, 'error' => 'not signed in'], 401);
            if (!$selfServiceOn()) return response()->json(['ok' => false, 'error' => 'self-service sharing is off'], 503);
            $secret = (string) env('LETWRITES_SHARE_SECRET', '');
            $brokerUrl = rtrim((string) env('LETWRITES_SHARE_URL', ''), '/');
            if ($secret === '' || $brokerUrl === '') return response()->json(['ok' => false, 'error' => 'sharing not configured'], 503);

            $type = (string) $request->input('entityType');
            $id = $request->input('entityId');
            if (!is_numeric($id) || !in_array($type, ['page', 'book', 'chapter', 'bookshelf'], true)) {
                return response()->json(['ok' => false, 'error' => 'bad entity'], 422);
            }
            $assertion = $mint($secret, auth()->user()->id, 'set-visibility', $type, (int) $id);
            try {
                // Wait long enough for a SLOW-but-working change (the broker makes up to 3 sequential
                // BookStack calls, each capped ~12s) so the user gets the real result, not a false
                // "couldn't reach". connectTimeout fails fast if the broker itself is down.
                $resp = \Illuminate\Support\Facades\Http::withHeaders(['X-Letwrites-Assertion' => $assertion])
                    ->connectTimeout(5)
                    ->timeout(40)
                    ->post("{$brokerUrl}/share/set-visibility", [
                        'entityType' => $type,
                        'entityId' => (int) $id,
                        'visibility' => (string) $request->input('visibility'),
                        'groups' => array_map('intval', (array) $request->input('groups', [])),
                        'level' => (string) $request->input('level', 'viewer'),
                    ]);
                return response()->json($resp->json() ?? ['ok' => false, 'error' => 'broker unreachable'], $resp->status());
            } catch (\Throwable $e) {
                return response()->json(['ok' => false, 'error' => 'could not reach the sharing service'], 502);
            }
        });

        // In-wiki import (A1): a native-feeling page on the wiki's OWN domain that renders the import
        // UI in the Letwrites brand and loads the SHARED UI asset from the import service
        // (/import/ui.js — same source as the standalone page, no duplication). The heavy upload goes
        // browser → /import/run directly (never through PHP). Session-gated: signed-in only.
        //
        // CSP: this route emits RAW HTML (not through BookStack's Blade layout), so it does NOT get
        // BookStack's automatic script-nonce. BookStack's CSP uses 'strict-dynamic', which IGNORES the
        // http:/https: allowlist and runs ONLY nonce-bearing scripts (and scripts THOSE insert). So we
        // (a) source the same per-request nonce BookStack put in the CSP header, (b) put it on a single
        // inline bootstrap, and (c) let that bootstrap inject /import/ui.js — strict-dynamic propagates
        // trust to the injected script, so we only depend on one nonce being correct.
        //
        // VERIFY-ON-LIVE: confirm the CSP nonce source resolves on your BookStack version (the loop
        // below tries the known classes) and that /api-tokens/{id}/create is the token route. The Node
        // UI asset it loads IS tested off-box.
        Route::get('/letwrites/import', function () use ($selfServiceOn) {
            if (!auth()->check()) {
                return redirect('/login');
            }
            // Self-service sharing lets a NON-admin importer restrict their import via the session/broker
            // (their API token can't set permissions). When on, hand the page the user's groups directly
            // (same source as /letwrites/share-context) so the group picker works without an admin token.
            $shareOn = $selfServiceOn();
            // "Only me" visibility only works for admins (they bypass content permissions); a non-admin
            // who picks it locks themselves out of their own import. The page offers it to admins only.
            $isAdmin = auth()->user()->roles()->where('system_name', 'admin')->exists();
            $groups = [];
            if ($shareOn) {
                try {
                    $groups = \BookStack\Users\Models\Role::query()
                        ->whereNotIn('system_name', ['admin', 'public'])
                        ->orderBy('display_name')->get(['id', 'display_name'])
                        ->map(fn ($r) => ['id' => $r->id, 'name' => (string) $r->display_name])->values()->all();
                } catch (\Throwable $e) {
                    $groups = [];
                }
            }
            // Source the request's CSP nonce from BookStack's own singleton (so it matches the header).
            // Try the known classes; fail safe to '' (which would block — caught by verify-live).
            $nonce = '';
            foreach (['BookStack\\Http\\Middleware\\ApplyCspRules', 'BookStack\\Util\\CspService'] as $svc) {
                try {
                    if (class_exists($svc)) {
                        $inst = app($svc);
                        if (method_exists($inst, 'getNonce')) {
                            $nonce = (string) $inst->getNonce();
                            if ($nonce !== '') {
                                break;
                            }
                        }
                    }
                } catch (\Throwable $e) {
                    // try the next source
                }
            }
            $n = htmlspecialchars($nonce, ENT_QUOTES, 'UTF-8');
            // The token-create route for THIS user (BookStack v26.05): /api-tokens/{id}/create.
            $tokenUrl = '/api-tokens/' . (int) auth()->user()->id . '/create?context=settings';
            $bootstrap = 'window.LW_IMPORT_BASE=location.origin;'
                . 'window.LW_TOKEN_URL=' . json_encode($tokenUrl) . ';'
                // Broker-backed visibility for non-admins: the picker uses these groups, and the page
                // restricts the created books via /letwrites/share-apply (same-origin, session-authed).
                . 'window.LW_SHARE_ENABLED=' . ($shareOn ? 'true' : 'false') . ';'
                . 'window.LW_IS_ADMIN=' . ($isAdmin ? 'true' : 'false') . ';'
                . 'window.LW_GROUPS=' . json_encode($groups) . ';'
                . 'window.LW_SHARE_APPLY_URL=' . json_encode('/letwrites/share-apply') . ';'
                . 'var s=document.createElement("script");s.src="/import/ui.js";document.body.appendChild(s);';
            $html = '<!doctype html><html lang="en"><head>'
                . '<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />'
                . '<title>Import from Confluence · Letwrites</title>'
                . '<link rel="preconnect" href="https://fonts.googleapis.com">'
                . '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
                . '<style>'
                . 'body{margin:0;background:#f6f8fc;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0b1220}'
                // Header matches the Letwrites website: dark bar, the L mark in a white rounded tile, white wordmark.
                . '.lw-bar{background:#0b1220;padding:14px 22px;display:flex;align-items:center;gap:12px}'
                . '.lw-bar .logo{width:32px;height:32px;border-radius:9px;background:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto}'
                . '.lw-bar .logo img{width:22px;height:22px;display:block}'
                . '.lw-bar b{font-size:17px;letter-spacing:-.02em;color:#fff;font-weight:700}'
                . '.lw-bar .muted{color:#9aa6b8;font-size:13px}'
                . '.lw-bar a{margin-left:auto;color:#cdd9ff;text-decoration:none;font-weight:600;font-size:14px}'
                . '.lw-page{max-width:760px;margin:28px auto;padding:0 20px}'
                . '</style></head><body>'
                . '<div class="lw-bar"><span class="logo"><img src="/import/logo.png" alt="Letwrites" /></span><b>Letwrites</b> <span class="muted">· Import from Confluence</span>'
                . '<a href="/">← Back to wiki</a></div>'
                . '<div class="lw-page"><div id="lw-import-mount"></div></div>'
                . '<script nonce="' . $n . '">' . $bootstrap . '</script>'
                . '</body></html>';
            return response($html, 200)->header('Content-Type', 'text/html; charset=utf-8');
        });
    });
})();
