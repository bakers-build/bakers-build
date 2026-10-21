<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbTicketDetailHeaderSource;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The ticket detail header names the assignee and the owner distinctly.
 *
 * The header band already named the conductor that claimed a ticket; this
 * settles that it also names who the ticket is assigned to and who created
 * it, each with its own label, and that an absent reference contributes no
 * part (and therefore no stray separator) rather than an empty one.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbTicketDetailHeaderSourceTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'ui_patterns',
    'link', 'text', 'bb_core',
  ];

  /**
   * The project the tickets belong to.
   */
  private int $projectId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // BbTicket::preSave() reaches into runs, so bb_run must exist too.
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // UID 1 dummy so entity ownership checks never land on UID 0.
    $this->createUser([], 'uid1-dummy');
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'header-project']);
    $project->save();
    $this->projectId = (int) $project->id();
  }

  /**
   * Creates and saves a ticket in this test's project.
   *
   * @param array<string, mixed> $values
   *   Extra field values merged over the defaults.
   */
  private function createTicket(array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create($values + [
        'title' => 'Header ticket',
        'workflow' => 'bb_feature',
        'project_id' => $this->projectId,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The assignee and the owner are named distinctly (AC-6).
   */
  public function testHeaderNamesTheAssigneeAndTheOwnerDistinctly(): void {
    $owner = $this->createUser([], 'Ada Lovelace');
    $assignee = $this->createUser([], 'Grace Hopper');
    self::assertInstanceOf(UserInterface::class, $owner);
    self::assertInstanceOf(UserInterface::class, $assignee);
    $ticket = $this->createTicket([
      'owner_user_id' => $owner->id(),
      'assignee_user_id' => $assignee->id(),
    ]);

    $description = $this->headerDescription($ticket);

    self::assertStringContainsString('assigned to Grace Hopper', $description);
    self::assertStringContainsString('created by Ada Lovelace', $description);
  }

  /**
   * A frozen ticket names that stall on the sub-line.
   */
  public function testHeaderNamesTheFrozenStall(): void {
    $ticket = $this->createTicket();
    $ticket->setFrozen(TRUE)->save();
    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->load($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);

    $description = $this->headerDescription($reloaded);

    self::assertStringContainsString('frozen', $description);
    self::assertMatchesRegularExpression('/frozen (just now|.+ ago)/', $description);
  }

  /**
   * An unassigned ticket omits the assignee part with no stray separator.
   */
  public function testHeaderOmitsTheAssigneePartWhenUnassigned(): void {
    $owner = $this->createUser([], 'Ada Lovelace');
    self::assertInstanceOf(UserInterface::class, $owner);
    $ticket = $this->createTicket([
      'owner_user_id' => $owner->id(),
      'assignee_user_id' => NULL,
    ]);

    $description = $this->headerDescription($ticket);

    self::assertStringContainsString('created by Ada Lovelace', $description);
    self::assertStringNotContainsString('assigned to', $description);
    self::assertStringNotContainsString(' ·  · ', $description);
  }

  /**
   * Both parts show, distinctly labelled, when owner and assignee coincide.
   */
  public function testHeaderShowsBothPartsWhenOwnerAndAssigneeAreTheSameUser(): void {
    $user = $this->createUser([], 'Ada Lovelace');
    self::assertInstanceOf(UserInterface::class, $user);
    $ticket = $this->createTicket([
      'owner_user_id' => $user->id(),
      'assignee_user_id' => $user->id(),
    ]);

    $description = $this->headerDescription($ticket);

    self::assertStringContainsString('assigned to Ada Lovelace', $description);
    self::assertStringContainsString('created by Ada Lovelace', $description);
  }

  /**
   * The rendered subline under the shell's page-header island.
   *
   * `BbTicketDetailHeaderSource::subline()` is the actual boundary now: the
   * source's own `getPropValue()` builds the `summary-band` component
   * (`flow`/`summary`/`links` slots), and the project/workflow/assignee/owner/
   * conductor sentence moved to the shell's page-header island, which calls
   * this static method directly. Asserting on it is still asserting on the
   * rendered value, not on configuration.
   */
  private function headerDescription(BbTicketInterface $ticket): string {
    return BbTicketDetailHeaderSource::subline($ticket);
  }

}
