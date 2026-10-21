<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Session\AccountInterface;

use Drupal\bb_core\Entity\BbGroup;
use Drupal\bb_core\Entity\BbProject;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\bb_core\Entity\BbWorkspace;

/**
 * Tests the access-gated computed edit_url field on bb_ticket.
 *
 * @group bb_core
 *
 * @covers \Drupal\bb_core\Field\EditUrlItemList
 */
final class EditUrlFieldTest extends BbEntityKernelTestBase {

  /**
   * With update access the field yields the workspace-scoped edit-form URL.
   *
   * The field is `$ticket->toUrl('edit-form')->toString()`, so it inherits the
   * BB-350 workspace prefix and the human identifier without any change of
   * its own. Asserted on the WHOLE path rather than on a `/edit` substring: the
   * substring passed before the move too, so it could not have caught a field
   * still emitting `/admin/bakers/ticket/1/edit`.
   */
  public function testEditUrlPresentWithUpdateAccess(): void {
    $admin = $this->createUser([], NULL, TRUE);
    self::assertInstanceOf(AccountInterface::class, $admin);
    $this->setCurrentUser($admin);

    $workspace = BbWorkspace::create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    $group = BbGroup::create(['name' => 'Acme group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = BbProject::create(['name' => 'acme', 'key' => 'ACME', 'group_id' => $group->id()]);
    $project->save();
    $ticket = BbTicket::create([
      'title' => 'T',
      'workflow' => 'bb_feature',
      'project_id' => $project->id(),
    ]);
    $ticket->save();

    self::assertSame('/acme/ticket/acme-1/edit', $ticket->get('edit_url')->value);
  }

  /**
   * Without update access the field stays empty (button hidden).
   */
  public function testEditUrlEmptyWithoutUpdateAccess(): void {
    // The uid 1 account is Drupal's root and bypasses every access check —
    // consume it with a throwaway account so the powerless user is uid 2+.
    $this->createUser([], NULL, TRUE);
    $nobody = $this->createUser();
    self::assertInstanceOf(AccountInterface::class, $nobody);
    $this->setCurrentUser($nobody);

    $ticket = BbTicket::create(['title' => 'T', 'workflow' => 'bb_feature']);
    $ticket->save();

    self::assertTrue($ticket->get('edit_url')->isEmpty());
  }

}
