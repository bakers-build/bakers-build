<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\TicketTemplate\TemplateNotFoundException;
use Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator;
use Drupal\bb_core\TicketTemplate\TicketTemplateValidationException;
use Drupal\filter\Entity\FilterFormat;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers ticket template instantiation (create, overrides, rejects).
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketTemplateInstantiationTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * The project every template in this test belongs to.
   */
  private BbProjectInterface $project;

  /**
   * The account instantiating templates in this test.
   */
  private UserInterface $actor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $entity_types = [
      'user', 'bb_project', 'bb_conductor', 'bb_ticket',
      'bb_ticket_template', 'bb_run', 'bb_comment',
    ];
    foreach ($entity_types as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    FilterFormat::create(['format' => 'bb_rich', 'name' => 'bakers.build rich'])->save();

    $etm = $this->container->get('entity_type.manager');
    $project = $etm->getStorage('bb_project')->create(['name' => 'tpl-project']);
    $this->assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    $this->project = $project;

    $this->actor = $this->createBbUser('tpl-actor', [
      'use bb_ticket_template',
      'create bb_ticket',
      'view bb_ticket',
      'view bb_ticket_template',
    ]);
  }

  /**
   * Freezes `datetime.time` to a fixed UTC instant and re-wires the service.
   */
  private function freezeTime(int $timestamp): void {
    $time = $this->createMock(TimeInterface::class);
    $time->method('getCurrentTime')->willReturn($timestamp);
    $time->method('getRequestTime')->willReturn($timestamp);
    $this->container->set('datetime.time', $time);
    $this->container->set('bb_core.ticket_template_instantiator', NULL);
  }

  /**
   * Returns the instantiator service, freshly built after freezeTime().
   */
  private function instantiator(): TicketTemplateInstantiator {
    return $this->container->get('bb_core.ticket_template_instantiator');
  }

  /**
   * Loads the ticket an instantiate() result names.
   *
   * @param array{ticket_uuid: string, identifier: string, created: bool} $result
   *   The instantiate() result.
   */
  private function ticketOf(array $result): BbTicketInterface {
    $ticket = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $result['ticket_uuid']);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Creates and saves a bb_ticket_template with sane defaults.
   *
   * @param array<string, mixed> $values
   *   Field values overriding the defaults.
   */
  private function createTemplate(array $values): BbTicketTemplateInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket_template');
    $template = $storage->create($values + [
      'name' => 'tpl',
      'enabled' => TRUE,
      'title_pattern' => 'Ticket',
      'description' => ['value' => 'Body', 'format' => 'plain_text'],
      'workflow' => 'bb_feature',
      'target_state' => 'qualification',
      'project_id' => $this->project->id(),
      'owner_user_id' => $this->actor->id(),
    ]);
    $this->assertInstanceOf(BbTicketTemplateInterface::class, $template);
    $template->save();
    return $template;
  }

  /**
   * Creates a user with the given permissions via a dedicated role.
   *
   * @param string $name
   *   The username.
   * @param array<string> $perms
   *   Permission machine names to grant.
   */
  private function createBbUser(string $name, array $perms): UserInterface {
    $role_id = 'r_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, $perms);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Substitution, copied fields, and the target_state transition.
   */
  public function testInstantiateCopiesFieldsAndSubstitutesPlaceholders(): void {
    // 2026-03-09 12:00:00 UTC.
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([
      'title_pattern' => 'Monthly report {{month}} ({{date}})',
      'target_state' => 'spec',
    ]);

    $result = $this->instantiator()->instantiate($template->uuid(), $this->actor);
    $this->assertTrue($result['created']);

    $ticket = $this->ticketOf($result);
    $this->assertSame('Monthly report 2026-03 (2026-03-09)', $ticket->label());
    $this->assertSame('bb_feature', $ticket->getWorkflow());
    $this->assertSame((int) $this->project->id(), (int) $ticket->get('project_id')->target_id);
    $this->assertSame((int) $template->id(), (int) $ticket->get('template_id')->target_id);
    $this->assertSame('spec', (string) $ticket->get('state')->value);
    $this->assertSame('Body', trim((string) $ticket->get('description')->value));
    $this->assertSame((int) $this->actor->id(), (int) $ticket->get('owner_user_id')->target_id);
  }

  /**
   * The result is exactly the three scalar outputs, no entity object.
   */
  public function testResultIsTheScalarContract(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([]);

    $result = $this->instantiator()->instantiate($template->uuid(), $this->actor);

    $this->assertSame(['ticket_uuid', 'identifier', 'created'], array_keys($result));
    $this->assertIsString($result['ticket_uuid']);
    $this->assertIsString($result['identifier']);
    $this->assertTrue($result['created']);
    $ticket = $this->ticketOf($result);
    $this->assertSame($ticket->getIdentifier(), $result['identifier']);
  }

  /**
   * Without a target state the template is valid and stays in the initial one.
   */
  public function testEmptyTargetStateKeepsTheInitialState(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate(['target_state' => NULL]);
    $this->assertFalse($template->getFieldDefinition('target_state')->isRequired(), 'A template may leave target_state empty.');

    $result = $this->instantiator()->instantiate($template->uuid(), $this->actor);

    $this->assertSame('qualification', (string) $this->ticketOf($result)->get('state')->value);
  }

  /**
   * An unknown placeholder is rejected and nothing is created.
   */
  public function testUnknownPlaceholderIsRejected(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate(['title_pattern' => 'Report {{bogus}}']);

    $this->expectException(TicketTemplateValidationException::class);
    try {
      $this->instantiator()->instantiate($template->uuid(), $this->actor);
    }
    finally {
      $count = (int) $this->container->get('entity_type.manager')->getStorage('bb_ticket')->getQuery()
        ->accessCheck(FALSE)->count()->execute();
      $this->assertSame(0, $count, 'No ticket must be created when a placeholder is unknown.');
    }
  }

  /**
   * A disabled template cannot be instantiated.
   */
  public function testDisabledTemplateIsRejected(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate(['enabled' => FALSE]);

    $this->expectException(TemplateNotFoundException::class);
    $this->instantiator()->instantiate($template->uuid(), $this->actor);
  }

  /**
   * The template_id field is server-owned: not writable via a ticket update.
   */
  public function testTemplateIdIsNotClientWritable(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([]);
    $result = $this->instantiator()->instantiate($template->uuid(), $this->actor);
    $ticket = $this->ticketOf($result);

    $this->assertFalse(
      $ticket->get('template_id')->access('edit', $this->actor),
      'template_id must not be editable by any actor.',
    );
  }

  /**
   * Counts every ticket row, bypassing access.
   */
  private function ticketCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->getQuery()->accessCheck(FALSE)->count()->execute();
  }

  /**
   * A template the actor cannot view does not exist for them.
   */
  public function testTemplateNotViewableIsNotFound(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([]);
    $blind = $this->createBbUser('tpl-noview', ['use bb_ticket_template', 'create bb_ticket']);

    $this->expectException(TemplateNotFoundException::class);
    $this->instantiator()->instantiate($template->uuid(), $blind);
  }

  /**
   * A failure after the first save() rolls the ticket back.
   *
   * An invalid target_state is only detected in applyTargetState(), after the
   * ticket row exists.
   */
  public function testFailureAfterSaveRollsBack(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate(['target_state' => 'no_such_state']);

    try {
      $this->instantiator()->instantiate($template->uuid(), $this->actor);
      $this->fail('A validation exception was expected.');
    }
    catch (TicketTemplateValidationException) {
    }
    $this->assertSame(0, $this->ticketCount(), 'The ticket saved before the failure must be rolled back.');
  }

  /**
   * Each override replaces the template default on the created ticket.
   *
   * @param string $key
   *   The override key.
   * @param string $value
   *   The override value.
   * @param string $field
   *   The ticket field that receives it.
   * @param string $expected
   *   The value expected on the ticket.
   */
  #[DataProvider('overrideProvider')]
  public function testEachOverrideReplacesTheDefault(string $key, string $value, string $field, string $expected): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate(['title_pattern' => 'Default', 'target_state' => '']);

    $ticket = $this->ticketOf($this->instantiator()->instantiate($template->uuid(), $this->actor, [$key => $value]));

    $this->assertSame($expected, trim((string) $ticket->get($field)->value));
    $this->assertSame((int) $template->id(), (int) $ticket->get('template_id')->target_id);
  }

  /**
   * The scalar overrides and where they land.
   *
   * @return array<string, array{string, string, string, string}>
   *   Key, value, ticket field, expected value.
   */
  public static function overrideProvider(): array {
    return [
      'title' => ['title', 'Overridden', 'title', 'Overridden'],
      'description' => ['description', 'Other body', 'description', 'Other body'],
      'workflow' => ['workflow', 'bb_bug', 'workflow', 'bb_bug'],
      'target_state' => ['target_state', 'spec', 'state', 'spec'],
    ];
  }

  /**
   * Keys outside the overridable set are rejected and nothing is created.
   */
  public function testUnknownOverrideIs422(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([]);
    foreach (['state' => 'coding', 'template_id' => 1, 'owner_user_id' => 1] as $key => $value) {
      try {
        $this->instantiator()->instantiate($template->uuid(), $this->actor, [$key => $value]);
        $this->fail("Override $key must be rejected.");
      }
      catch (TicketTemplateValidationException) {
      }
    }
    $this->assertSame(0, $this->ticketCount());
  }

  /**
   * A project template creates tickets only in its own project.
   */
  public function testProjectTemplateRejectsOtherProject(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([]);
    $other = $this->container->get('entity_type.manager')->getStorage('bb_project')->create(['name' => 'other']);
    $other->save();

    try {
      $this->instantiator()->instantiate($template->uuid(), $this->actor, ['project_id' => (int) $other->id()]);
      $this->fail('A validation exception was expected.');
    }
    catch (TicketTemplateValidationException $e) {
      $this->assertSame('A project template creates tickets only in its own project.', $e->getMessage());
    }
    $this->assertSame(0, $this->ticketCount());
  }

  /**
   * Passing a project template's own project is accepted.
   */
  public function testProjectTemplateAcceptsItsOwnProject(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([]);

    $result = $this->instantiator()->instantiate($template->uuid(), $this->actor, ['project_id' => (int) $this->project->id()]);

    $this->assertSame((int) $this->project->id(), (int) $this->ticketOf($result)->get('project_id')->target_id);
  }

  /**
   * A workflow override re-checks the template's target state against it.
   */
  public function testWorkflowOverrideRevalidatesTargetState(): void {
    $this->freezeTime(1773057600);
    // `spec` is reachable in bb_feature, not in bb_bug.
    $template = $this->createTemplate(['target_state' => 'spec']);

    try {
      $this->instantiator()->instantiate($template->uuid(), $this->actor, ['workflow' => 'bb_bug']);
      $this->fail('A validation exception was expected.');
    }
    catch (TicketTemplateValidationException) {
    }
    $this->assertSame(0, $this->ticketCount());

    $result = $this->instantiator()->instantiate($template->uuid(), $this->actor, [
      'workflow' => 'bb_bug',
      'target_state' => 'diagnose',
    ]);
    $this->assertSame('diagnose', (string) $this->ticketOf($result)->get('state')->value);
  }

  /**
   * Placeholders render in an overridden title too.
   */
  public function testPlaceholdersRenderInOverrides(): void {
    // 2026-03-09 12:00:00 UTC.
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([]);

    $result = $this->instantiator()->instantiate($template->uuid(), $this->actor, ['title' => 'Probe {{month}}']);

    $this->assertSame('Probe 2026-03', $this->ticketOf($result)->label());
  }

  /**
   * There is no deduplication: two calls create two tickets.
   */
  public function testInstantiatingTwiceCreatesTwoTickets(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate([]);

    $first = $this->instantiator()->instantiate($template->uuid(), $this->actor);
    $second = $this->instantiator()->instantiate($template->uuid(), $this->actor);

    $this->assertTrue($first['created']);
    $this->assertTrue($second['created']);
    $this->assertNotSame($first['ticket_uuid'], $second['ticket_uuid']);
    $this->assertSame(2, $this->ticketCount());
  }

  /**
   * The prefilled ticket carries the rendered defaults and is not saved.
   */
  public function testPrefillRendersTheDefaults(): void {
    $this->freezeTime(1773057600);
    $template = $this->createTemplate(['title_pattern' => 'Report {{date}}']);

    $ticket = $this->instantiator()->prefill($template);

    $this->assertTrue($ticket->isNew());
    $this->assertSame('Report 2026-03-09', $ticket->label());
    $this->assertSame('bb_feature', $ticket->getWorkflow());
    $this->assertSame((int) $this->project->id(), (int) $ticket->get('project_id')->target_id);
    $this->assertSame(0, $this->ticketCount());
  }

}
