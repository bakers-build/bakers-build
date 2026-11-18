<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel\Tool;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Tests\bb_track\Kernel\LegacyWorklogFixture;
use Drupal\bb_track\Entity\Worklog;
use Drupal\tool\FormattedToolResultInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * An owner's agent deletes a recorded or proposed entry under the form rules.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogDeleteToolTest extends TimeToolTestBase {

  /**
   * An entry without source is removed; one with source is voided.
   */
  public function testDeleteRemovesOrVoids(): void {
    $sourced = $this->container->get('bb_track.activity_input')->input($this->activity('sourced'));
    $manual = $this->manual('recorded');
    $listed = $this->outputs($this->runTool('bakers_worklog_list', ['from' => '2026-08-01', 'to' => '2026-08-09']))['data'];
    $versions = array_column($listed, 'version', 'id');

    $out = $this->outputs($this->delete($manual, ['version' => $versions[$manual->uuid()]]));
    self::assertSame(['id' => $manual->uuid(), 'voided' => FALSE], $out);
    self::assertNull($this->stored($manual));

    $out = $this->outputs($this->delete($sourced, ['version' => $versions[$sourced->uuid()]]));
    self::assertSame(['id' => $sourced->uuid(), 'voided' => TRUE], $out);
    $voided = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->loadUnchanged($sourced->id());
    self::assertInstanceOf(Worklog::class, $voided);
    self::assertTrue((bool) $voided->get('voided')->value);
    $week = ['from' => '2026-08-01', 'to' => '2026-08-09'];
    self::assertSame([], $this->outputs($this->runTool('bakers_worklog_list', $week))['data']);
  }

  /**
   * Every refusal names its reason and leaves the entry in place.
   */
  public function testRefusalsLeaveTheEntryInPlace(): void {
    $entry = $this->manual('recorded');
    $approved = $this->manual('approved');
    $this->container->get('current_user')->setAccount($this->peer);
    $foreign = $this->container->get('bb_track.activity_input')->input($this->activity('peer'));
    $this->container->get('current_user')->setAccount($this->employee);
    $cases = [
      'unknown uuid' => [$entry, ['worklog' => $this->container->get('uuid')->generate()], 'Worklog unavailable.'],
      'foreign' => [$foreign, [], 'Worklog unavailable.'],
      'approved' => [$approved, [], 'You may not delete this worklog: only its owner may'],
      'stale version' => [$entry, ['version' => 'stale'], 'This entry changed. Refresh before deleting.'],
      'state input' => [$entry, ['state' => 'voided'], 'state'],
    ];
    foreach ($cases as $case => [$target, $override, $message]) {
      $before = $this->stored($target);
      $result = $this->delete($target, $override);
      self::assertFalse($result->isSuccess(), $case);
      self::assertStringContainsString($message, (string) $result->getMessage(), $case);
      self::assertSame($before, $this->stored($target), $case);
    }

    // A voided entry is gone for the tools.
    $sourced = $this->container->get('bb_track.activity_input')->input($this->activity('sourced'));
    $version = $sourced->version();
    $this->outputs($this->runTool('bakers_worklog_delete', ['worklog' => $sourced->uuid(), 'version' => $version]));
    // The next call is a new request.
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_track_worklog')->resetCache();
    $this->assertFailure($this->delete($sourced, ['version' => $this->stored($sourced)]), 'Worklog unavailable.');

    // An owner whose rank grants recording loses it when demoted to guest.
    $ranked = $this->createUser(['view bb_project', 'view bb_ticket', 'view bb_group'], 'ranked');
    self::assertInstanceOf(UserInterface::class, $ranked);
    $this->addMembership($this->fixtureWorkspace(), $ranked, ['lead']);
    $this->container->get('current_user')->setAccount($ranked);
    $own = $this->manual('recorded', $ranked);
    $this->addMembership($this->fixtureWorkspace(), $ranked, ['guest']);
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_track_worklog')->resetCache();
    $this->assertFailure($this->delete($own), 'You may not delete this worklog: only its owner may');
    self::assertSame($own->version(), $this->stored($own));

    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    self::assertFalse($this->delete($entry)->isSuccess());
    self::assertNotNull($this->stored($entry));
  }

  /**
   * Deletes an entry at its current version unless the values say otherwise.
   *
   * @param \Drupal\bb_track\Entity\Worklog $entry
   *   The entry.
   * @param array<string, mixed> $values
   *   Tool inputs.
   */
  private function delete(Worklog $entry, array $values = []): FormattedToolResultInterface {
    $values += ['worklog' => $entry->uuid(), 'version' => $entry->version()];
    return $this->runTool('bakers_worklog_delete', $values);
  }

  /**
   * An entry without source in the given state, by default the employee's.
   */
  private function manual(string $state, ?UserInterface $owner = NULL): Worklog {
    $entry = Worklog::create([
      'owner_user_id' => ($owner ?? $this->employee)->id(),
      'work_date' => '2026-08-03',
      'duration_seconds' => 3600,
      'description' => 'Manual work',
      'state' => $state,
      'project_id' => $this->project->id(),
    ]);
    assert($entry instanceof Worklog);
    LegacyWorklogFixture::save($entry);
    $saved = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->loadUnchanged($entry->id());
    assert($saved instanceof Worklog);
    return $saved;
  }

  /**
   * The stored entry's lock token, or NULL when it no longer exists.
   */
  private function stored(Worklog $entry): ?string {
    $saved = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->loadUnchanged($entry->id());
    return $saved instanceof Worklog ? $saved->version() : NULL;
  }

}
