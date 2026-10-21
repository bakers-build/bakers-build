<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_ticket_trigger\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\bb_ticket_trigger_test\Plugin\BbTicketTriggerTarget\TestTicket;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * New trigger types and targets plug in without touching the runner.
 *
 * The fixture type `test_event` is event-driven: its own code fires it
 * through TicketTriggerRunner::fire(), and cron never picks it up. The
 * fixture target `test_ticket` acts on a ticket instead of a template.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTriggerExtensionTest extends KernelTestBase {

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
    'bb_api_key', 'bb_ticket_trigger',
  ];

  /**
   * An event type fires once per key and leaves the template untouched.
   */
  public function testEventTypeFiresOncePerKey(): void {
    $field_manager = $this->container->get('entity_field.manager');
    $template_fields = array_keys($field_manager->getBaseFieldDefinitions('bb_ticket_template'));
    $this->enableModules(['bb_ticket_trigger_test']);
    $field_manager = $this->container->get('entity_field.manager');
    $field_manager->clearCachedFieldDefinitions();
    $this->assertSame($template_fields, array_keys($field_manager->getBaseFieldDefinitions('bb_ticket_template')));

    $this->installTriggerWorld();
    $this->freezeTriggerTime('2026-10-20T00:00:00Z');
    $trigger = $this->newTrigger('a', [
      'trigger_type' => ['plugin_id' => 'test_event', 'plugin_configuration' => []],
      'actor_uid' => $this->serviceAccount('a')->id(),
      'enabled' => TRUE,
    ]);
    $this->assertSame([], $this->triggerViolations($trigger));
    $trigger->save();
    $this->assertNull($trigger->getNextRun());
    $runner = $this->container->get('bb_ticket_trigger.runner');

    $this->assertSame('success', $runner->fire($trigger, 100));
    $this->assertSame('skipped', $runner->fire($trigger, 100));
    $this->assertSame('success', $runner->fire($trigger, 101));
    $runner->runDue();

    $count = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->getQuery()
      ->accessCheck(FALSE)->condition('template_id', $this->triggerTemplate('a')->id())->count()->execute();
    $this->assertSame(2, (int) $count);
  }

  /**
   * Installs the world with the fixtures and a `test_ticket` trigger on A.
   */
  private function ticketTrigger(): BbTicketTriggerInterface {
    $this->enableModules(['bb_ticket_trigger_test']);
    $this->installTriggerWorld();
    $this->freezeTriggerTime('2026-10-20T00:00:00Z');
    $trigger = $this->newTrigger('a', [
      'bundle' => 'test_ticket',
      'template_id' => NULL,
      'test_ticket_id' => $this->ticket()->id(),
      'trigger_type' => ['plugin_id' => 'test_event', 'plugin_configuration' => []],
      'actor_uid' => $this->serviceAccount('a')->id(),
      'enabled' => TRUE,
    ]);
    $this->assertSame([], $this->triggerViolations($trigger));
    $trigger->save();
    return $trigger;
  }

  /**
   * The ticket fixture of side A.
   */
  private function ticket(): BbTicketInterface {
    $ticket = $this->fixture('a', 'bb_ticket');
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Ticket count of the whole site.
   */
  private function ticketCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('bb_ticket')->getQuery()
      ->accessCheck(FALSE)->count()->execute();
  }

  /**
   * A second target acts once per key through the unchanged runner.
   */
  public function testTargetSeam(): void {
    $trigger = $this->ticketTrigger();
    $tickets = $this->ticketCount();
    $runner = $this->container->get('bb_ticket_trigger.runner');
    $acted = [(int) $this->ticket()->id(), (int) $trigger->getActor()?->id()];

    $this->assertSame('success', $runner->fire($trigger, 100));
    $this->assertSame([$acted], \Drupal::state()->get(TestTicket::ACTED));
    $stored = $this->reload($trigger);
    $this->assertSame((int) $this->ticket()->id(), (int) $stored->get('last_ticket_id')->target_id);
    $this->assertSame(sprintf('Acted on %s.', $this->ticket()->getIdentifier()), $stored->get('last_message')->value);

    $this->assertSame('skipped', $runner->fire($trigger, 100));
    $this->assertSame('success', $runner->fire($trigger, 101));
    $this->assertSame([$acted, $acted], \Drupal::state()->get(TestTicket::ACTED));
    $this->assertSame($tickets, $this->ticketCount());
  }

  /**
   * The target's transient failures are retried, then fail.
   */
  public function testTargetTransientFailureRetries(): void {
    $trigger = $this->ticketTrigger();
    \Drupal::state()->set(TestTicket::FAIL, 'transient');
    $runner = $this->container->get('bb_ticket_trigger.runner');
    $this->assertSame(['retrying', 'retrying', 'failed'], [
      $runner->fire($trigger, 200),
      $runner->fire($trigger, 200),
      $runner->fire($trigger, 200),
    ]);
    $this->assertSame([], \Drupal::state()->get(TestTicket::ACTED, []));
  }

  /**
   * The target's permanent failures fail at once.
   */
  public function testTargetPermanentFailureFailsAtOnce(): void {
    $trigger = $this->ticketTrigger();
    \Drupal::state()->set(TestTicket::FAIL, 'permanent');
    $this->assertSame('failed', $this->container->get('bb_ticket_trigger.runner')->fire($trigger, 300));
  }

  /**
   * Access and listings follow the ticket's workspace.
   */
  public function testTargetAccessAndQueryAccess(): void {
    $trigger = $this->ticketTrigger();
    $this->assertFalse($trigger->access('view', $this->lead('b')));
    $this->assertFalse($trigger->access('update', $this->lead('b')));
    $this->assertTrue($trigger->access('view', $this->lead('a')));
    $this->assertNotContains((int) $trigger->id(), $this->queryIdsAs('bb_ticket_trigger', $this->member('b')));
    $this->assertContains((int) $trigger->id(), $this->queryIdsAs('bb_ticket_trigger', $this->lead('a')));
  }

  /**
   * Deleting a target deletes its triggers, and only those.
   */
  public function testTriggersAreDeletedWithTheirTarget(): void {
    $trigger = $this->ticketTrigger();
    $template_trigger = $this->newTrigger('a');
    $template_trigger->save();
    $this->ticket()->delete();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger');
    $this->assertNull($storage->loadUnchanged($trigger->id()));
    $this->assertNotNull($storage->loadUnchanged($template_trigger->id()));
  }

  /**
   * The trigger as stored.
   */
  private function reload(BbTicketTriggerInterface $trigger): BbTicketTriggerInterface {
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_ticket_trigger')->loadUnchanged($trigger->id());
    self::assertInstanceOf(BbTicketTriggerInterface::class, $stored);
    return $stored;
  }

}
