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
})();
