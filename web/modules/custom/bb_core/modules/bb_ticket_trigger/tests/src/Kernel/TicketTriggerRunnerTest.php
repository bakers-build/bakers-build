<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_ticket_trigger\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerRunner;
use Drupal\bb_ticket_trigger_test\Hook\TicketSaveFailureHooks;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Due occurrences create exactly one ticket each, as the service account.
 *
 * Every trigger is monthly on day 1 at 09:00 Europe/Berlin.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTriggerRunnerTest extends KernelTestBase {

  use TicketTriggerTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'serialization', 'options', 'entity',
    'state_machine', 'link', 'text', 'filter', 'markdown_easy', 'field', 'og',
    'plugin', 'consumers', 'simple_oauth', 'views', 'island', 'bb_core',
    'bb_api_key', 'bb_ticket_trigger', 'bb_ticket_trigger_test',
  ];

  /**
   * The Contributor service account the triggers run as.
   */
  private UserInterface $actor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installTriggerWorld();
    $this->actor = $this->serviceAccount('a');
  }

  /**
   * Saves an enabled monthly trigger at a given instant.
   */
  private function activeTrigger(string $at = '2026-10-20T00:00:00Z'): BbTicketTriggerInterface {
    $this->freezeTriggerTime($at);
    $trigger = $this->newTrigger('a', ['actor_uid' => $this->actor->id(), 'enabled' => TRUE]);
    $this->assertSame([], $this->triggerViolations($trigger));
    $trigger->save();
    return $trigger;
  }

  /**
   * The runner, built after the last freezeTriggerTime().
   */
  private function runner(): TicketTriggerRunner {
    return $this->container->get('bb_ticket_trigger.runner');
  }

  /**
   * Reloads a trigger from storage.
   */
  private function reload(BbTicketTriggerInterface $trigger): BbTicketTriggerInterface {
    $fresh = $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->loadUnchanged($trigger->id());
    self::assertInstanceOf(BbTicketTriggerInterface::class, $fresh);
    return $fresh;
  }

  /**
   * The tickets created from the side-a template, oldest first.
   *
   * @return array<\Drupal\bb_core\Entity\BbTicketInterface>
   *   The tickets.
   */
  private function templateTickets(): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('template_id', $this->triggerTemplate('a')->id())
      ->sort('id')
      ->execute();
    return array_values(array_filter($storage->loadMultiple($ids), static fn ($ticket): bool => $ticket instanceof BbTicketInterface));
  }

  /**
   * A UTC instant as a timestamp.
   */
  private static function at(string $instant): int {
    return (new \DateTimeImmutable($instant))->getTimestamp();
  }

  /**
   * A due occurrence creates one ticket owned by the service account.
   */
  public function testDueOccurrenceCreatesTicket(): void {
    $trigger = $this->activeTrigger();
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');

    $this->assertSame('success', $this->runner()->run($trigger));

    $tickets = $this->templateTickets();
    $this->assertCount(1, $tickets);
    $this->assertSame((int) $this->actor->id(), (int) $tickets[0]->get('owner_user_id')->target_id);
    $trigger = $this->reload($trigger);
    $this->assertSame('success', $trigger->getLastStatus());
    $this->assertSame((int) $tickets[0]->id(), (int) $trigger->get('last_ticket_id')->target_id);
    $this->assertSame(self::at('2026-11-01T08:00:00Z'), $trigger->getLastOccurrence());
    $this->assertSame(self::at('2026-12-01T08:00:00Z'), $trigger->getNextRun());
  }

  /**
   * Before its due time nothing happens.
   */
  public function testNotDueDoesNothing(): void {
    $trigger = $this->activeTrigger();
    $this->freezeTriggerTime('2026-11-01T07:59:00Z');

    $this->runner()->run($trigger);

    $this->assertSame([], $this->templateTickets());
    $this->assertSame('', $this->reload($trigger)->getLastStatus());
  }

  /**
   * An open ticket of the template does not block the next occurrence.
   */
  public function testOpenTicketDoesNotBlock(): void {
    $trigger = $this->activeTrigger();
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');
    $this->runner()->run($trigger);
    $this->freezeTriggerTime('2026-12-01T08:05:00Z');

    $this->assertSame('success', $this->runner()->run($this->reload($trigger)));

    $tickets = $this->templateTickets();
    $this->assertCount(2, $tickets);
    $this->assertFalse($tickets[0]->isClosed());
  }

  /**
   * A repeated delivery of a handled occurrence is skipped, even after close.
   */
  public function testReplayAfterCloseCreatesNothing(): void {
    $trigger = $this->activeTrigger();
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');
    $this->runner()->run($trigger);
    $ticket = $this->templateTickets()[0];
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->markClosed(self::at('2026-11-02T00:00:00Z'))->save();

    $status = $this->runner()->fire($this->reload($trigger), self::at('2026-11-01T08:00:00Z'));

    $this->assertSame('skipped', $status);
    $this->assertCount(1, $this->templateTickets());
  }

  /**
   * A handled occurrence recorded in storage wins over a warm entity cache.
   */
  public function testReplayKeyIsReadPastTheEntityCache(): void {
    $trigger = $this->activeTrigger();
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');
    // Warms the cache, then records the occurrence as another process would.
    $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->load($trigger->id());
    $this->container->get('database')->update('bb_ticket_trigger')
      ->fields(['last_occurrence' => self::at('2026-11-01T08:00:00Z')])
      ->condition('id', $trigger->id())
      ->execute();

    $this->assertSame('skipped', $this->runner()->run($trigger));
    $this->assertSame([], $this->templateTickets());
  }

  /**
   * A trigger that throws does not stop the others in the same cron run.
   */
  public function testThrowingTriggerDoesNotStopTheOthers(): void {
    $broken = $this->activeTrigger();
    $healthy = $this->activeTrigger();
    // Runs after the broken one: due order is `next_run`.
    $this->container->get('database')->update('bb_ticket_trigger')
      ->fields(['next_run' => self::at('2026-11-01T08:01:00Z')])
      ->condition('id', $healthy->id())
      ->execute();
    $this->container->get('state')->set(TicketSaveFailureHooks::TRIGGER_STATE_KEY, $broken->id());
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');

    $this->runner()->runDue();

    $this->assertCount(1, $this->templateTickets());
    $this->assertSame(BbTicketTriggerInterface::STATUS_SUCCESS, $this->reload($healthy)->get('last_status')->value);
  }

  /**
   * Missed months collapse into one run of the latest due occurrence.
   */
  public function testMissedOccurrencesCollapse(): void {
    $trigger = $this->activeTrigger();
    $this->container->get('database')->update('bb_ticket_trigger')
      ->fields(['next_run' => self::at('2026-08-01T07:00:00Z')])
      ->condition('id', $trigger->id())
      ->execute();
    $this->freezeTriggerTime('2026-11-02T00:00:00Z');

    $this->runner()->run($this->reload($trigger));

    $this->assertCount(1, $this->templateTickets());
    $trigger = $this->reload($trigger);
    $this->assertSame(self::at('2026-11-01T08:00:00Z'), $trigger->getLastOccurrence());
    $this->assertStringContainsString('3 missed occurrence', (string) $trigger->get('last_message')->value);
  }

  /**
   * Resuming after a pause does not catch up on the paused occurrence.
   */
  public function testPauseResumeDoesNotBackfill(): void {
    $trigger = $this->activeTrigger();
    $this->freezeTriggerTime('2026-10-25T00:00:00Z');
    $trigger->set('enabled', FALSE)->save();
    $this->freezeTriggerTime('2026-11-10T00:00:00Z');
    $trigger->set('enabled', TRUE)->save();

    $this->runner()->runDue();

    $this->assertSame([], $this->templateTickets());
    $this->assertSame(self::at('2026-12-01T08:00:00Z'), $this->reload($trigger)->getNextRun());
  }

  /**
   * A transient failure retries the same occurrence three times, then fails.
   */
  public function testTransientFailureRetriesThreeTimes(): void {
    $trigger = $this->activeTrigger();
    $this->container->get('state')->set(TicketSaveFailureHooks::STATE_KEY, TRUE);
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');

    foreach ([1, 2] as $attempt) {
      $this->assertSame('retrying', $this->runner()->run($this->reload($trigger)), "attempt $attempt retries");
      $this->assertSame(self::at('2026-11-01T08:00:00Z'), $this->reload($trigger)->getNextRun());
      $this->assertSame($attempt, $this->reload($trigger)->getAttempts());
    }
    $this->assertSame('failed', $this->runner()->run($this->reload($trigger)));

    $this->assertSame([], $this->templateTickets());
    $trigger = $this->reload($trigger);
    $this->assertSame(self::at('2026-12-01T08:00:00Z'), $trigger->getNextRun());
    $this->assertSame(0, $trigger->getAttempts());
    $this->assertSame(self::at('2026-11-01T08:00:00Z'), $trigger->getLastOccurrence());
  }

  /**
   * A permanent failure fails at once and moves on.
   */
  public function testPermanentFailureIsNotRetried(): void {
    $trigger = $this->activeTrigger();
    $this->triggerTemplate('a')->set('enabled', FALSE)->save();
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');

    $this->assertSame('failed', $this->runner()->run($this->reload($trigger)));

    $trigger = $this->reload($trigger);
    $this->assertStringContainsString('disabled', (string) $trigger->get('last_message')->value);
    $this->assertSame(self::at('2026-12-01T08:00:00Z'), $trigger->getNextRun());
    $this->assertSame([], $this->templateTickets());
  }

  /**
   * A disabled service account makes the run unavailable; it stays enabled.
   */
  public function testBlockedActorIsUnavailable(): void {
    $trigger = $this->activeTrigger();
    $this->serviceAccounts()->disable($this->actor, $this->lead('a'));
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');

    $this->assertSame('unavailable', $this->runner()->run($this->reload($trigger)));

    $this->assertSame([], $this->templateTickets());
    $trigger = $this->reload($trigger);
    $this->assertTrue($trigger->isEnabled());
    $this->assertSame(self::at('2026-12-01T08:00:00Z'), $trigger->getNextRun());
  }

  /**
   * A stored type with no plugin is unavailable and creates nothing.
   */
  public function testUnknownTypeIsUnavailable(): void {
    $trigger = $this->activeTrigger();
    $this->container->get('database')->update('bb_ticket_trigger')
      ->fields(['trigger_type__plugin_id' => 'missing_plugin'])
      ->condition('id', $trigger->id())
      ->execute();
    $this->freezeTriggerTime('2026-11-01T08:05:00Z');

    $this->assertSame('unavailable', $this->runner()->run($this->reload($trigger)));

    $this->assertSame([], $this->templateTickets());
    $trigger = $this->reload($trigger);
    $this->assertSame('missing_plugin', $trigger->getType());
    $this->assertStringContainsString('missing_plugin', (string) $trigger->get('last_message')->value);
  }

  /**
   * Cron runs only enabled triggers that are due.
   */
  public function testCronRunsOnlyDueEnabledTriggers(): void {
    $this->activeTrigger();
    $paused = $this->activeTrigger();
    $paused->set('enabled', FALSE)->save();
    $future = $this->activeTrigger('2026-11-01T08:30:00Z');
    $this->assertSame(self::at('2026-12-01T08:00:00Z'), $future->getNextRun());
    $this->freezeTriggerTime('2026-11-01T08:35:00Z');

    $this->container->get('cron')->run();

    $this->assertCount(1, $this->templateTickets());
  }

}
