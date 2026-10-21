<?php

// Komodo deployment settings — included from settings.php when running in a deployed
// Komodo container (DB_HOST is set there, absent under DDEV). Overrides the ddev-local
// DB creds + salt with per-stack env vars, so ONE settings.php serves local + every
// deploy environment. Nothing here is hardcoded per environment.
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
  // value travels Komodo Variable -> bakers.toml -> compose env -> here.
  $config['social_auth_google.settings']['client_id'] = getenv('BB_OAUTH_GOOGLE_CLIENT_ID') ?: '';
  $config['social_auth_google.settings']['client_secret'] = getenv('BB_OAUTH_GOOGLE_CLIENT_SECRET') ?: '';
}

if (getenv('DRUPAL_HASH_SALT')) {
  $settings['hash_salt'] = getenv('DRUPAL_HASH_SALT');
}

// Reuses git.key-tec.de's SMTP account via core's own Symfony transport, switched
// on by pointing system.mail's `mailer_dsn` at the parsed DSN — no contrib mailer
// module involved. The backend stays `bb_html_mail`, which extends core's
// `symfony_mailer` plugin, so SMTP mail keeps the shared HTML envelope.
//
// `parse_url()` returns the userinfo components percent-ENCODED and never
// decodes them, but the DSN must encode them: the SMTP username is an e-mail
// address (`gitlab@keytec.de`), and its `@` has to be written `%40` or the
// first `@` would be read as the userinfo/host separator. So the value here
// is `rawurldecode()`d back to the literal credential before it reaches the
// transport — without it Gmail authenticates against `gitlab%40keytec.de` and
// returns `535 5.7.8 Username and Password not accepted`.
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

// Trust the per-stack deployment domain. DOMAIN is set per Komodo stack, so this ONE
// file (baked into the shared image) serves every environment.
if (getenv('DOMAIN')) {
  $settings['trusted_host_patterns'][] = '^' . preg_quote(getenv('DOMAIN'), '/') . '$';
}
