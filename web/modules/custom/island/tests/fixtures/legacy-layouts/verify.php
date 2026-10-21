<?php

/**
 * @file
 * Verifies the live legacy upgrade before and after CIM without creating data.
 */

declare(strict_types=1);

use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

$shell = IslandProfile::load('bb_shell');
$gate = IslandProfile::load('bb_gate');
if (!$shell || !$gate || App::load('bakers')?->getProviderId() !== 'default') {
  throw new \RuntimeException('The standalone bakers.build app and both migrated profiles must exist.');
}
$expected = [
  'shell priority' => [$shell->get('weight'), -27],
  'shell paths' => [$shell->get('conditions'), ['paths' => ['/_workspace/*']]],
  'gate title' => [$gate->getLayoutSettings()['title'], 'Migrated bakers.build'],
  'gate paths' => [$gate->get('conditions'), ['paths' => ['/home', '/legacy-upgrade-gate']]],
  'shell placement IDs' => [
    array_keys($shell->get('placements')),
    ['shell_rail', 'shell_topbar', 'shell_content_island', 'shell_status_bar'],
  ],
  'gate placement IDs' => [array_keys($gate->get('placements')), ['gate_mark', 'gate_main']],
  'rail depth' => [
    $shell->getPlacement('shell_rail')['configuration']['component']['props']['items']['source']['depth'],
    2,
  ],
  'rail target' => [$shell->getPlacement('shell_rail')['configuration']['target_placement'], 'shell_content_island'],
  'tab settings' => [
    $shell->getPlacement('shell_content_island')['configuration']['prefix_blocks']['shell_tabs']['configuration'],
    ['primary' => TRUE, 'secondary' => FALSE],
  ],
];
foreach ($expected as $label => [$actual, $value]) {
  if ($actual !== $value) {
    throw new \RuntimeException("Migration comparison failed: $label");
  }
  echo "PASS $label\n";
}
$before = [$shell->toArray(), $gate->toArray()];
$created = \Drupal::service('island.profile_migrator')->migrate();
$after = [IslandProfile::load('bb_shell')->toArray(), IslandProfile::load('bb_gate')->toArray()];
if ($created !== 0 || $before !== $after) {
  throw new \RuntimeException('Repeated migration changed profiles or placement IDs.');
}
echo "PASS repeat migration: 0 profiles created, settings and IDs unchanged\n";
$storage = \Drupal::service('config.storage');
foreach (\Drupal::state()->get('island.migration_fixture.original', []) as $name => $original) {
  $active = $storage->read($name);
  if ($active !== FALSE && $active !== $original) {
    throw new \RuntimeException("Legacy source changed before cleanup: $name");
  }
}
echo 'Legacy module: ' . (\Drupal::moduleHandler()->moduleExists('display_builder_page_layout') ? 'enabled' : 'absent') . "\n";
echo 'Legacy configuration objects: ' . count($storage->listAll('display_builder_page_layout.page_layout.')) . "\n";
