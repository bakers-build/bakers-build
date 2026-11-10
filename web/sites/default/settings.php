<?php

// bakers.build `playground` (default) site. Committed settings: ddev-local DB creds and
// the site salt are not real secrets and live here. Only genuine secrets (the
// GitLab API token) are read from the environment via getenv().
//
// DDEV db host/user/pass are shared across bakers.build sites; the default site uses the
// `db` database.
$databases['default']['default'] = [
  'database' => 'db',
  'username' => 'db',
  'password' => 'db',
  'host' => 'db',
  'port' => 3306,
  'driver' => 'mysql',
  'namespace' => 'Drupal\\mysql\\Driver\\Database\\mysql',
  'autoload' => 'core/modules/mysql/src/Driver/Database/mysql/',
  'prefix' => '',
];

// Fixed salt: the playground site should not rotate its salt across reinstalls.
$settings['hash_salt'] = 'bakers-playground-qP7mD2xK9vL4nR8tB3yC6sH1aF5gW0eJ';
$settings['config_sync_directory'] = '../config/sync';
$settings['file_private_path'] = 'sites/default/files/private';

// Trust the ddev reverse proxy (mirrors settings.ddev.php for the default site).
$settings['reverse_proxy'] = TRUE;
$settings['trusted_host_patterns'] = ['.*'];
// BB-550: reverse_proxy was TRUE with no reverse_proxy_addresses, so
// Request::getClientIp() (used to key the device-authorization flood guard
// per caller) returned the proxy's own address for every request instead of
// the real client. Both ddev's proxy and Komodo's Caddy sit on a private
// Docker network, so trusting the private ranges is the fix rather than one
// fixed IP that would drift with the container.
$settings['reverse_proxy_addresses'] = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

// Local development (DDEV only — never on a deployed/Komodo container): enable
// Twig theme debug (template-suggestion + source comments) and disable the
// render/page caches so template + preprocess changes show immediately. This is
// how we inspect which presenter templates / preprocess hooks apply. Gated on
// IS_DDEV_PROJECT so it can live in the tracked settings.php and take effect on
// every `ddev init` without touching production.
if (getenv('IS_DDEV_PROJECT') === 'true') {
  // Keep sites/default and settings.php writable. Drupal makes both read-only
  // after an install (permissions hardening); under DDEV that blocks git from
  // rewriting settings files on a merge or checkout. The generated
  // settings.ddev.php sets this too, but this file does not include it.
  $settings['skip_permissions_hardening'] = TRUE;
  // Own services file (not the Composer-scaffolded development.services.yml,
  // which gets overwritten on `composer require`) — carries twig.config debug.
  $settings['container_yamls'][] = dirname(__DIR__) . '/bakers.dev.services.yml';
  $config['system.logging']['error_level'] = 'verbose';
  $settings['cache']['bins']['render'] = 'cache.backend.null';
  $settings['cache']['bins']['page'] = 'cache.backend.null';
  $settings['cache']['bins']['dynamic_page_cache'] = 'cache.backend.null';
  // The `bb_html_mail` backend delivers through Symfony's transport, not
  // PHP's mail(); the web container has no /usr/sbin/sendmail, so point the
  // transport at Mailpit's SMTP port, where PHP's sendmail_path ends anyway.
  $config['system.mail']['mailer_dsn'] = [
    'scheme' => 'smtp',
    'host' => '127.0.0.1',
    'user' => NULL,
    'password' => NULL,
    'port' => 1025,
    'options' => [],
  ];
}

// Operator feature flags: only an explicit 1/true enables; anything else is
// off. The SaaS stack (docker-compose.yml) pins run-log storage to 0.
$settings['feature_flags']['run_log_storage'] = in_array(
  strtolower(trim((string) getenv('FEATURE_FLAG_RUN_LOG_STORAGE'))),
  ['1', 'true'],
  TRUE,
);

// Komodo deployment (hosted container): override the ddev-local DB creds + salt above
// with the per-stack env vars when running in a deployed container (DB_HOST is set there,
// absent under DDEV). Keeps ONE settings.php for local + every deploy environment.
if (getenv('DB_HOST') && file_exists(__DIR__ . '/settings.container.php')) {
  include __DIR__ . '/settings.container.php';
}
