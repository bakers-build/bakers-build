<?php

/**
 * @file
 * Environment overrides for deployed containers.
 */

use Symfony\Component\HttpFoundation\Request;

// Each block applies only when its own variable is set; unset leaves Drupal's default.
if ($proxy_subnet = getenv('TRUSTED_PROXY_SUBNET')) {
  $cidr = explode('/', $proxy_subnet);
  if (count($cidr) !== 2 || !filter_var($cidr[0], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) || !ctype_digit($cidr[1]) || (int) $cidr[1] < 1 || (int) $cidr[1] > 32) {
    throw new \RuntimeException('TRUSTED_PROXY_SUBNET must be an IPv4 CIDR with prefix 1 through 32');
  }
  $settings['reverse_proxy'] = TRUE;
  $settings['reverse_proxy_addresses'] = [$proxy_subnet];
  $settings['reverse_proxy_trusted_headers'] = Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_PROTO | Request::HEADER_X_FORWARDED_PORT;
}
if ($smtp_dsn = getenv('MAIL_SMTP_DSN')) {
  $smtp = parse_url($smtp_dsn);
  if ($smtp === FALSE || !in_array($smtp['scheme'] ?? '', ['smtp', 'smtps'], TRUE) || empty($smtp['host'])) {
    throw new \RuntimeException('MAIL_SMTP_DSN must be an smtp or smtps URL with a host');
  }
}
if (getenv('MAIL_FROM_ADDRESS') && !filter_var(getenv('MAIL_FROM_ADDRESS'), FILTER_VALIDATE_EMAIL)) {
  throw new \RuntimeException('MAIL_FROM_ADDRESS must be an email address');
}

// Deployment settings — included from settings.php when running in a
// deployed container (DB_HOST is set there, absent under DDEV). Overrides the
// ddev-local DB creds + salt with per-stack env vars, so ONE settings.php
// serves local + every deploy environment. Nothing here is hardcoded per environment.
if (getenv('DB_HOST')) {
  $databases['default']['default'] = [
    'database' => getenv('DB_NAME'),
    'username' => getenv('DB_USER'),
    'password' => getenv('DB_PASSWORD'),
    'host' => getenv('DB_HOST'),
    'port' => getenv('DB_PORT') ?: '3306',
    'driver' => getenv('DB_DRIVER') ?: 'mysql',
    'namespace' => 'Drupal\\mysql\\Driver\\Database\\mysql',
    'autoload' => 'core/modules/mysql/src/Driver/Database/mysql/',
    'prefix' => '',
  ];

  // Private files live on their OWN mounted volume, OUTSIDE the docroot
  // (docroot is /var/www/html/web; this path is one level up). The base
  // settings.php default `sites/default/files/private` is a playground/ddev
  // path that sits INSIDE the public_files volume and is web-reachable — wrong
  // for a deployed site, and it leaves the mounted `private_files` volume
  // (docker-compose.yml -> /var/www/html/private-files) unused. Override it so
  // deployed environments actually use that volume.
  $settings['file_private_path'] = '/var/www/html/private-files';

  // simple_oauth signing keys: env-specific paths (the deploy one-shot runs
  // `simple-oauth:generate-keys /var/www/oauth-keys`). Kept out of config/sync
  // (which is env-agnostic + re-exported from ddev) via a settings override.
  $config['simple_oauth.settings']['public_key'] = '/var/www/oauth-keys/public.key';
  $config['simple_oauth.settings']['private_key'] = '/var/www/oauth-keys/private.key';

  // OAuth / social sign-in (BB-476): Google client credentials. NEVER IN
  // config/sync. Overrides are not exported, so the repository copy stays
  // empty and a repository read yields no usable credential (AC-9). The
  // value travels compose env -> here.
  $config['social_auth_google.settings']['client_id'] = getenv('BB_OAUTH_GOOGLE_CLIENT_ID') ?: '';
  $config['social_auth_google.settings']['client_secret'] = getenv('BB_OAUTH_GOOGLE_CLIENT_SECRET') ?: '';
}

if (getenv('DRUPAL_HASH_SALT')) {
  $settings['hash_salt'] = getenv('DRUPAL_HASH_SALT');
}

// Uses the operator's SMTP account via core's own Symfony transport, switched
// on by pointing system.mail's `mailer_dsn` at the parsed DSN — no contrib
// mailer module involved. The backend stays `bb_html_mail`, which extends core's
// `symfony_mailer` plugin, so SMTP mail keeps the shared HTML envelope.
//
// `parse_url()` returns the userinfo components percent-ENCODED and never
// decodes them, but the DSN must encode them: the SMTP username is an e-mail
// address (`mailer@example.org`), and its `@` has to be written `%40` or the
// first `@` would be read as the userinfo/host separator. So the value here
// is `rawurldecode()`d back to the literal credential before it reaches the
// transport — without it the server authenticates against the encoded
// address and returns `535 5.7.8 Username and Password not accepted`.
if (getenv('MAIL_SMTP_DSN')) {
  $mail_dsn = parse_url((string) getenv('MAIL_SMTP_DSN'));
  if ($mail_dsn !== FALSE && isset($mail_dsn['scheme'], $mail_dsn['host'])) {
    parse_str($mail_dsn['query'] ?? '', $mail_dsn_options);
    $config['system.mail']['interface']['default'] = 'bb_html_mail';
    $config['system.mail']['mailer_dsn'] = [
      'scheme' => $mail_dsn['scheme'],
      'host' => $mail_dsn['host'],
      'user' => isset($mail_dsn['user']) ? rawurldecode($mail_dsn['user']) : NULL,
      'password' => isset($mail_dsn['pass']) ? rawurldecode($mail_dsn['pass']) : NULL,
      'port' => $mail_dsn['port'] ?? NULL,
      'options' => $mail_dsn_options,
    ];
  }
}
if (getenv('MAIL_FROM_ADDRESS')) {
  $config['system.site']['mail'] = getenv('MAIL_FROM_ADDRESS');
}

// A forwarded DOMAIN is the only host this site answers to.
if (getenv('DOMAIN')) {
  if (!filter_var(getenv('DOMAIN'), FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
    throw new \RuntimeException('DOMAIN must be a DNS hostname without a scheme or path');
  }
  $settings['trusted_host_patterns'] = ['^' . preg_quote(getenv('DOMAIN'), '/') . '$'];
}
