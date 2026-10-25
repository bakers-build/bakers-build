<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\BranchName;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the stored branch_name field on bb_ticket.
 *
 * Branch_name is derived from identifier + title as `feat/<id>-<title>` (capped
 * at 30 chars, identifier never truncated), frozen on first save, and never
 * changed afterwards.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BranchNameTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership',
      'bb_group',
      'bb_project',
      'bb_conductor',
      'bb_ticket',
      'bb_comment',
      'bb_run',
      'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * Creates and saves a ticket, returning it.
   */
  private function createTicket(string $identifier, string $title): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $ticket = $storage->create([
      'identifier' => $identifier,
      'workflow' => 'bb_work',
      'title' => $title,
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Identifier + title slugify into feat/<id>-<title> on save.
   */
  public function testFreezesGitSafeBranchName(): void {
    $ticket = $this->createTicket('GL-7', 'Fix Login Flow!');
    $this->assertSame('feat/gl-7-fix-login-flow', $ticket->get('branch_name')->value);
  }

  /**
   * An empty title yields an identifier-only branch.
   */
  public function testEmptyTitleYieldsIdOnlyBranch(): void {
    $ticket = $this->createTicket('GL-7', '');
    $this->assertSame('feat/gl-7', $ticket->get('branch_name')->value);
  }

  /**
   * The whole branch is capped at 30 chars; the title is truncated to fit.
   */
  public function testCapsBranchAtThirtyChars(): void {
    $ticket = $this->createTicket('BB-4242', 'A very long human readable ticket title');
    $branch = (string) $ticket->get('branch_name')->value;
    // feat/bb-4242 = 12 chars, so 17 chars remain for "-<title>": the title
    // slug is cut to those 17 chars ("a-very-long-human").
    $this->assertSame('feat/bb-4242-a-very-long-human', $branch);
    $this->assertSame(30, mb_strlen($branch));
  }

  /**
   * A long identifier fills the whole budget so the title is dropped.
   *
   * The identifier is still never truncated, even past 30 chars.
   */
  public function testLongIdentifierDropsTitle(): void {
    $ticket = $this->createTicket('bb-1234567890abcdef123456', 'Some title');
    // feat/bb-1234567890abcdef123456 = 30 chars, no room for a title.
    $this->assertSame('feat/bb-1234567890abcdef123456', $ticket->get('branch_name')->value);
  }

  /**
   * The branch is frozen on first save and a later title edit never changes it.
   */
  public function testBranchIsFrozenAcrossTitleEdits(): void {
    $ticket = $this->createTicket('GL-7', 'First title');
    $this->assertSame('feat/gl-7-first-title', $ticket->get('branch_name')->value);

    $ticket->set('title', 'Completely different title');
    $ticket->save();
    $this->assertSame('feat/gl-7-first-title', $ticket->get('branch_name')->value);
  }

  /**
   * The single sanitise rule preserves '.'/'_' (needed for '/'-path templates).
   *
   * Consolidating onto one path means the default convention now runs through
   * BranchName::sanitize() (keeps `._/-`) rather than the old slug (only
   * `[a-z0-9-]`).
   * The common identifier/title shapes are unaffected (see the cases above);
   * this pins the one place the rules differ so the change is deliberate, not
   * accidental: `.` and `_` in a title now survive into the branch.
   */
  public function testSanitiseKeepsDotAndUnderscore(): void {
    $ticket = $this->createTicket('GL-7', 'Fix v1.0_beta bug');
    $this->assertSame('feat/gl-7-fix-v1.0_beta-bug', $ticket->get('branch_name')->value);
  }

  /**
   * Shared post-processing (BranchName::cap()) never truncates the identifier.
   *
   * This is the single truncation contract now applied to every convention
   * (default or repo-supplied), not just the old hard-coded feat/ path.
   */
  public function testCapBranchNameProtectsIdentifier(): void {
    // Over budget: only the trailing title is cut to fit 30 chars.
    $this->assertSame(
      'feat/bb-4242-a-very-long-human',
      BranchName::cap('feat/bb-4242-a-very-long-human-readable-title', 'bb-4242'),
    );
    // The identifier alone fills the budget: the title is dropped and the
    // identifier is returned untruncated even past 30 chars.
    $this->assertSame(
      'feat/bb-1234567890abcdef123456',
      BranchName::cap('feat/bb-1234567890abcdef123456-some-title', 'bb-1234567890abcdef123456'),
    );
    // Under budget is returned unchanged.
    $this->assertSame(
      'feat/gl-7-fix-login-flow',
      BranchName::cap('feat/gl-7-fix-login-flow', 'gl-7'),
    );
  }

}
