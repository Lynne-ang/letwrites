<?php
/**
 * Canonical Letwrites share-assertion mint. This is the ONE place the theme builds the assertion
 * token, extracted from functions.php so it can be unit-tested without a running BookStack.
 *
 * It MUST byte-match the Node broker's verifier (letwrites-enterprise/src/share/assertion.ts).
 * Both repos test the exact same golden token in assertion-vector.json — if you touch the format
 * or encoding here, that test fails on both sides. Do not change one side without the other.
 *
 *   signed string : v1|<userId>|<action>|<entityType>|<entityId>|<expUnixSec>|<nonceHex>
 *   token         : base64url(signedString) "." base64url(hmacSha256(secret, signedString))
 */
if (!function_exists('letwrites_mint_assertion')) {
    function letwrites_mint_assertion(string $secret, $userId, string $action, string $entityType, int $entityId, int $exp, string $nonce): string
    {
        if ($secret === '') {
            throw new \InvalidArgumentException('share secret required to mint');
        }
        // Fields that go into the pipe-delimited string must not themselves contain a pipe, or the
        // verifier would split them wrong (matches the Node mint's guard).
        foreach (['userId' => $userId, 'action' => $action, 'entityType' => $entityType, 'nonce' => $nonce] as $k => $v) {
            if (strpos((string) $v, '|') !== false) {
                throw new \InvalidArgumentException("assertion field {$k} must not contain '|'");
            }
        }
        if ($entityId <= 0) {
            throw new \InvalidArgumentException('entityId must be a positive integer');
        }
        $ss = "v1|{$userId}|{$action}|{$entityType}|{$entityId}|{$exp}|{$nonce}";
        $b64u = static fn (string $d): string => rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
        return $b64u($ss) . '.' . $b64u(hash_hmac('sha256', $ss, $secret, true));
    }
}
