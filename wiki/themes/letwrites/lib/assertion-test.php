<?php
/**
 * Contract test for the PHP side of the share assertion. Proves the theme's mint reproduces the
 * shared golden token byte-for-byte — i.e. it still agrees with the Node broker's verifier.
 *
 *   php wiki/themes/letwrites/lib/assertion-test.php      # exits 0 on match, 1 on drift
 *
 * Runs in CI (no BookStack needed). If this fails, the PHP theme and the Node broker have DRIFTED;
 * fix the code so both produce the vector again — never edit the vector to make it pass.
 */
require_once __DIR__ . '/assertion.php';

$vector = json_decode(file_get_contents(__DIR__ . '/assertion-vector.json'), true);
if (!is_array($vector) || !isset($vector['token'])) {
    fwrite(STDERR, "FAIL: could not read assertion-vector.json\n");
    exit(1);
}

$got = letwrites_mint_assertion(
    $vector['secret'],
    $vector['userId'],
    $vector['action'],
    $vector['entityType'],
    (int) $vector['entityId'],
    (int) $vector['exp'],
    $vector['nonce']
);

if (!hash_equals($vector['token'], $got)) {
    fwrite(STDERR, "FAIL: PHP mint does not match the contract vector.\n");
    fwrite(STDERR, "  expected: {$vector['token']}\n");
    fwrite(STDERR, "  got:      {$got}\n");
    fwrite(STDERR, "The PHP theme and Node broker have DRIFTED. Fix the code so both agree (do not edit the vector).\n");
    exit(1);
}

echo "OK: PHP assertion mint matches the contract vector.\n";
exit(0);
