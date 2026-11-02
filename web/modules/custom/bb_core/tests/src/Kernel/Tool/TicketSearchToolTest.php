<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A search through its tool matches title and description under read access.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketSearchToolTest extends BakersToolTestBase {

  /**
   * Matches title or description, optionally narrowed to a project.
   */
  public function testSearchMatchesTitleAndDescription(): void {
    $title = $this->ticket('Fix the login form', ['ticket_type' => $this->term('type', 'bug')->id()]);
    $body = $this->ticket('Other', ['description' => ['value' => 'The LOGIN breaks', 'format' => 'bb_rich']]);
    $this->ticket('Unrelated');

    $out = $this->outputs($this->runTool('bakers_ticket_search', ['query' => 'login']));
    $rows = $out['tickets'];
    usort($rows, static fn (array $a, array $b): int => strcmp($a['title'], $b['title']));
    self::assertSame([
      [
        'identifier' => $title->getIdentifier(),
        'title' => 'Fix the login form',
        'state' => 'qualification',
        'type' => 'bug',
        'branch_name' => $title->get('branch_name')->value,
        'base_branch' => 'main',
        'parent' => NULL,
      ],
      [
        'identifier' => $body->getIdentifier(),
        'title' => 'Other',
        'state' => 'qualification',
        'type' => NULL,
        'branch_name' => $body->get('branch_name')->value,
        'base_branch' => 'main',
        'parent' => NULL,
      ],
    ], $rows);

    $values = ['query' => 'login', 'project' => $this->project->uuid()];
    $out = $this->outputs($this->runTool('bakers_ticket_search', $values));
    self::assertCount(2, $out['tickets']);
  }

  /**
   * An outsider finds nothing; an unknown project is an input error.
   */
  public function testSearchAppliesReadAccess(): void {
    $this->ticket('Secret login');
    $unknown = '00000000-0000-4000-8000-000000000000';
    $this->assertFailure($this->runTool('bakers_ticket_search', ['query' => 'login', 'project' => $unknown]), $unknown);
    $this->container->get('current_user')->setAccount($this->account('outsider', ['skill_user']));
    self::assertSame([], $this->outputs($this->runTool('bakers_ticket_search', ['query' => 'login']))['tickets']);
  }

  /**
   * An exact branch finds its one ticket with the parent the base comes from.
   */
  public function testBranchLookupIsExactAndNamesParent(): void {
    $parent = $this->ticket('REL-1', ['branch_name' => 'release/1.2']);
    $child = $this->ticket('CH-1', ['branch_name' => 'feat/ch-1', 'parent_id' => $parent->id()]);
    $this->ticket('CH-2', ['branch_name' => 'feat/ch-1-more']);
    $out = $this->outputs($this->runTool('bakers_ticket_search', [
      'branch_name' => 'feat/ch-1',
      'project' => $this->project->uuid(),
    ]));
    self::assertCount(1, $out['tickets']);
    self::assertSame($child->getIdentifier(), $out['tickets'][0]['identifier']);
    self::assertSame('release/1.2', $out['tickets'][0]['base_branch']);
    self::assertSame($parent->getIdentifier(), $out['tickets'][0]['parent']);
  }

  /**
   * A search needs a text or a branch.
   */
  public function testQueryOrBranchIsRequired(): void {
    $this->assertFailure($this->runTool('bakers_ticket_search', []), 'Give a query or a branch_name.');
  }

}
