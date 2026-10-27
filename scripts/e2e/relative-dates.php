<?php

/**
 * @file
 * Puts the e2e fixtures' relative timestamps on calendar days before now.
 *
 * Run with `drush php:script` by seed-test-world.sh. BB_E2E_DATES_MODE=seed
 * also creates the missing statistics demo project, tickets and runs;
 * `dates-only` only re-dates existing entities and fails when the demo data
 * is missing. Both are idempotent.
 */

declare(strict_types=1);

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Symfony\Component\Yaml\Yaml;

/**
 * The timestamp of a whole-day offset before now.
 *
 * Today is within the last hour (never in the future, never yesterday);
 * every earlier day is its 12:00 UTC, far from both day boundaries.
 */
function bb_e2e_day_offset(int $days, int $now): int {
  $today = intdiv($now, 86400) * 86400;
  return $days === 0 ? max($today, $now - 3600) : $today - $days * 86400 + 43200;
}

// Self-check at the two clock positions where a naive offset breaks.
foreach (['00:30', '23:30'] as $clock) {
  $fixed = (new \DateTimeImmutable('2026-03-01 ' . $clock, new \DateTimeZone('UTC')))->getTimestamp();
  $today = bb_e2e_day_offset(0, $fixed);
  ($today >= intdiv($fixed, 86400) * 86400 && $today <= $fixed) || throw new \LogicException('day offset 0 left today at ' . $clock);
  gmdate('Y-m-d', bb_e2e_day_offset(1, $fixed)) === '2026-02-28' || throw new \LogicException('day offset 1 is not yesterday at ' . $clock);
}

$mode = getenv('BB_E2E_DATES_MODE') ?: 'dates-only';
$map = Yaml::parseFile(DRUPAL_ROOT . '/../recipes/bb_e2e/fixture-states.yml');
$etm = \Drupal::entityTypeManager();
$tickets = $etm->getStorage('bb_ticket');
$runs = $etm->getStorage('bb_run');
$now = \Drupal::time()->getRequestTime();

foreach (($map['bb_ticket_closed_date_days_ago'] ?? []) as $identifier => $days) {
  if (!is_int($days) || $days < 0) {
    throw new \RuntimeException('Invalid closed-date offset for ' . $identifier);
  }
  $found = $tickets->loadByProperties(['identifier' => $identifier]);
  if (count($found) !== 1) {
    throw new \RuntimeException('Expected one closed-date fixture ticket for ' . $identifier);
  }
  $ticket = reset($found);
  assert($ticket instanceof BbTicketInterface);
  $ticket->markClosed(bb_e2e_day_offset($days, $now))->save();
}

$demo = $map['statistics_demo'] ?? NULL;
if ($demo === NULL) {
  return;
}

$projects = $etm->getStorage('bb_project');
$project = current($projects->loadByProperties(['key' => $demo['project']['key']])) ?: NULL;
if ($project === NULL) {
  if ($mode !== 'seed') {
    throw new \RuntimeException('The statistics demo project is missing; run the full seed first.');
  }
  $template = current($projects->loadByProperties(['key' => $demo['project']['template']]));
  if (!$template instanceof BbProjectInterface) {
    throw new \RuntimeException('Missing statistics demo template project ' . $demo['project']['template']);
  }
  $project = $projects->create([
    'name' => $demo['project']['label'],
    'key' => $demo['project']['key'],
    'group_id' => $template->get('group_id')->target_id,
    'teams' => [],
    'owner_user_id' => $template->get('owner_user_id')->target_id,
    'next_number' => count($demo['tickets']) + 1,
  ]);
  $project->save();
}
elseif ($mode === 'seed' && !$project->get('teams')->isEmpty()) {
  $project->set('teams', [])->save();
}

$runIndex = 0;
foreach ($demo['tickets'] as $number => $row) {
  $found = $tickets->loadByProperties(['identifier' => $row['identifier']]);
  $ticket = reset($found) ?: NULL;
  if ($ticket === NULL) {
    if ($mode !== 'seed') {
      throw new \RuntimeException('Statistics demo ticket ' . $row['identifier'] . ' is missing; run the full seed first.');
    }
    $ticket = $tickets->create([
      'identifier' => $row['identifier'],
      'number' => $number + 1,
      'workflow' => 'bb_work',
      'title' => 'Statistics demo ' . ($number + 1),
      'project_id' => $project->id(),
      // Open demo tickets stay unassigned so no one's work list grows.
      'assignee_user_id' => $row['closed_days_ago'] === NULL ? NULL : $project->get('owner_user_id')->target_id,
      'owner_user_id' => $project->get('owner_user_id')->target_id,
    ]);
    $ticket->save();
    // `qualification` is the open state no board count asserts.
    $ticket->set('state', $row['closed_days_ago'] === NULL ? 'qualification' : 'done')->save();
  }
  assert($ticket instanceof BbTicketInterface);
  if ($mode === 'seed' && $row['closed_days_ago'] === NULL) {
    $ticket->set('state', 'qualification')->set('assignee_user_id', NULL);
  }
  $ticket->set('created', bb_e2e_day_offset($row['created_days_ago'], $now));
  if ($row['closed_days_ago'] !== NULL) {
    $ticket->markClosed(bb_e2e_day_offset($row['closed_days_ago'], $now));
    $rating = $demo['ratings'][$number % count($demo['ratings'])];
    $metrics = array_filter($ticket->get('metrics')->getValue(), static fn(array $metric): bool => $metric['name'] !== 'job_rating.score');
    if ($rating !== NULL) {
      $metrics[] = ['name' => 'job_rating.score', 'value' => $rating];
    }
    $ticket->set('metrics', array_values($metrics));
  }
  $ticket->save();

  $existing = array_values($runs->loadByProperties(['ticket_id' => $ticket->id()]));
  usort($existing, static fn($left, $right): int => (int) $left->id() <=> (int) $right->id());
  foreach ($row['runs_days_ago'] as $index => $days) {
    $run = $existing[$index] ?? NULL;
    if ($run === NULL) {
      if ($mode !== 'seed') {
        throw new \RuntimeException('A statistics demo run of ' . $row['identifier'] . ' is missing; run the full seed first.');
      }
      $run = $runs->create(['ticket_id' => $ticket->id(), 'state_at_start' => 'working']);
      $run->save();
      $run->set('state', 'done');
    }
    $time = bb_e2e_day_offset($days, $now);
    $run->set('created', $time)
      ->set('tokens', $demo['run_tokens'][$runIndex % count($demo['run_tokens'])])
      ->set('model', $demo['models'][$runIndex % count($demo['models'])])
      ->save();
    $runIndex++;
  }
}
