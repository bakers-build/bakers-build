<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel\Tool;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_track\Entity\Submission;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Personal evidence never mixes another employee's time or records proposals.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogListToolTest extends TimeToolTestBase {

  /**
   * Reads page through own recorded/proposed time without mutating it.
   */
  public function testPersonalPagination(): void {
    $input = $this->container->get('bb_track.activity_input');
    $own = $input->input($this->activity('own'));
    $submission = Submission::create(['state' => 'proposed']);
    $submission->save();
    $proposal = $input->input($this->activity('proposal') + ['submission_id' => (int) $submission->id()]);
    $this->container->get('current_user')->setAccount($this->peer);
    $foreign = $input->input($this->activity('peer'));
    $this->addMembership($this->project->get('teams')->entity, $this->employee, ['lead']);
    $this->container->get('current_user')->setAccount($this->employee);
    self::assertTrue($foreign->access('view', $this->employee));
    $selection = ['from' => '2026-08-03', 'to' => '2026-08-09', 'limit' => 1];
    $first = $this->outputs($this->runTool('bakers_worklog_list', $selection));
    self::assertSame([$own->uuid()], array_column($first['data'], 'id'));
    self::assertSame($this->project->uuid(), $first['data'][0]['project_id']);
    self::assertSame([['id' => $this->project->uuid(), 'name' => 'Work']], $first['projects']);
    self::assertFalse($first['omitted']);
    self::assertSame(1, $first['next_offset']);
    $second = $this->outputs($this->runTool('bakers_worklog_list', $selection + ['offset' => 1]));
    self::assertSame([$proposal->uuid()], array_column($second['data'], 'id'));
    self::assertSame('proposed', $second['data'][0]['state']);
    self::assertSame($submission->uuid(), $second['data'][0]['submission_id']);
    self::assertSame(7200, $second['data'][0]['duration_seconds']);
    self::assertCount(1, $second['data'][0]['source_keys']);
    self::assertNull($second['next_offset'] ?? NULL);
    self::assertSame('proposed', Submission::load($submission->id())->get('state')->value);
  }

  /**
   * Invalid selection and anonymous reads cannot yield an apparent empty day.
   */
  public function testInvalidAndAnonymousReads(): void {
    foreach ([
      ['from' => '2026-02-30', 'to' => '2026-03-01'],
      ['from' => '2026-08-09', 'to' => '2026-08-03'],
      ['from' => '2025-01-01', 'to' => '2026-01-14'],
      ['from' => '2026-08-03', 'to' => '2026-08-09', 'owner' => $this->peer->uuid()],
      ['from' => '2026-08-03', 'to' => '2026-08-09', 'offset' => -1],
      ['from' => '2026-08-03', 'to' => '2026-08-09', 'limit' => 51],
    ] as $selection) {
      self::assertFalse($this->runTool('bakers_worklog_list', $selection)->isSuccess(), var_export($selection, TRUE));
    }
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    self::assertFalse($this->runTool('bakers_worklog_list', ['from' => '2026-08-03', 'to' => '2026-08-09'])->isSuccess());
  }

}
