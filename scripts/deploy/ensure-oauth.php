<?php

/**
 * @file
 * One-time per-user OAuth consumer bootstrap for conductor write-back.
 *
 * Run via `drush php:script scripts/deploy/ensure-oauth.php` from the
 * deliberate one-shot `install` service ONLY (never from the per-deploy
 * `deploy` service), AFTER config:import and AFTER the team users and their
 * workspace memberships exist (deployment content).
 *
 * Provisions ONE confidential client_credentials consumer PER team user, bound
 * to that user, so the conductor authenticates and writes back AS the real
 * user.
 *
 * A team user is an account holding an active `og_membership` on a
 * `bb_workspace` (BB-391 D5). It used to be an account holding the
 * site-wide `bb_agent` role, but D2 deleted that role: capability lives in OG
 * ranks (BB-359), so membership is the only source of it — and now the only
 * source of this seed too, rather than a second parallel answer on a role.
 *
 * The consumer is issued with the ONE bakers.build scope, `bb_session`, and
 * issuing it is not optional. The scope carries real authority: for a
 * `client_credentials` token `Oauth2AccessPolicy::alterPermissions()` replaces
 * the account's permissions with EXACTLY the scope's, so a consumer seeded
 * with no scopes mints no usable token at all. Which ROWS the token then
 * reaches still comes from the account's ranks.
 *
 * `bb_session` is an UMBRELLA, and only its id is written here on purpose:
 * `Oauth2ScopeProvider::getPermissions()` resolves the union of its 27
 * per-permission children at request time, so the ceiling can be widened or
 * narrowed in `config/sync` and the recipe without touching this script. The
 * corollary is that a site where the umbrella imported but its children did not
 * mints a perfectly valid token that can read nothing.
 *
 * CREATE-ONLY (BB-111): a consumer is seeded exactly once, when it is missing.
 * An existing consumer is NEVER touched — no re-hash, no rotation — so a
 * developer's working, locally-stored secret can never be silently invalidated
 * by a deploy. After the initial seed, consumers (incl. secret rotation) are
 * managed through the Drupal consumers UI (/admin/config/services/consumer).
 *
 * The user's account name IS the short handle (Kürzel: cw, mz, …). It keys both
 * the consumer client_id (`bakers-<kuerzel>`) and the per-user secret env var
 * (`BB_CONSUMER_SECRET_<KUERZEL>`). Secrets come from the environment (one
 * Komodo variable per user), never from config.
 *
 * The public `bakers-cli` consumer needs no secret; bb_core_install() creates
 * it on every install path (Drupal\bb_core\Install\CliConsumer).
 */

use Drupal\consumers\Entity\Consumer;
use Drupal\bb_core\Deploy\OauthConsumerCandidates;
use Drupal\bb_core\Deploy\OauthConsumerSecret;

$etm = \Drupal::entityTypeManager();
$userStorage = $etm->getStorage('user');
$consumerStorage = $etm->getStorage('consumer');

// Team users = accounts holding an active workspace membership (BB-391 D5).
// The selection lives in a class so it can be asserted on; see
// OauthConsumerCandidatesTest for why that matters (an under-matching selector
// produces a shorter success log, not an error).
$uids = OauthConsumerCandidates::uids($etm);

if (!$uids) {
  print "No workspace members found — nothing to seed (recipe content applied?).\n";
  return;
}

printf("Found %d workspace member(s) to consider.\n", count($uids));

foreach ($userStorage->loadMultiple($uids) as $user) {
  $kuerzel = $user->getAccountName();
  $clientId = 'bakers-' . $kuerzel;
  // Env var names allow only [A-Z0-9_]; sanitize handles like "pascal.glass".
  $envKey = 'BB_CONSUMER_SECRET_' . strtoupper(preg_replace('/[^A-Za-z0-9]/', '_', $kuerzel));
  $secret = getenv($envKey) ?: '';

  $exists = (bool) $consumerStorage->loadByProperties(['client_id' => $clientId]);
  $action = OauthConsumerSecret::decide($exists, $secret);

  if ($action === OauthConsumerSecret::SKIP_EXISTING) {
    // The consumer is already provisioned — leave it untouched (UI-managed).
    printf("Kept existing consumer %s -> user %s (uid %s) [untouched]\n", $clientId, $kuerzel, $user->id());
    continue;
  }

  if ($action === OauthConsumerSecret::SKIP_EMPTY) {
    // Cannot seed a usable client_credentials consumer without a secret.
    printf(
      "Skipped consumer %s -> user %s (uid %s) [WARNING: no %s in env; create it manually in the consumers UI]\n",
      $clientId,
      $kuerzel,
      $user->id(),
      $envKey,
    );
    continue;
  }

  // CREATE — one-time seed of a missing consumer from the env secret.
  $consumer = Consumer::create(['client_id' => $clientId]);
  $consumer->set('label', 'bakers.build agent — ' . $kuerzel);
  $consumer->set('is_default', FALSE);
  $consumer->set('confidential', TRUE);
  $consumer->set('grant_types', ['client_credentials']);
  $consumer->set('secret', $secret);
  $consumer->set('user_id', $user->id());
  // The ONE scope (BB-391). It is the consumer's DEFAULT scope, so a request
  // that names none still mints a usable token — and it is what a
  // client_credentials token's permission set becomes, verbatim, because
  // Oauth2AccessPolicy overwrites everything the access policies calculated.
  // Seeding no scope here produces a consumer whose token either does not mint
  // or carries nothing, and neither failure names a permission.
  $consumer->set('scopes', [['scope_id' => 'bb_session']]);
  $consumer->save();

  printf("Seeded consumer %s -> user %s (uid %s) [created]\n", $clientId, $kuerzel, $user->id());
}
