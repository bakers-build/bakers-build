<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\og\Entity\OgRole;
use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Labels of a protected namespace need a workspace permission to be added.
 *
 * @see \Drupal\bb_core\Plugin\Validation\Constraint\BbTicketProtectedLabelConstraint
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProtectedLabelTest extends BakersToolTestBase {

  /**
   * The protected `runtime:system` label.
   */
  private ContentEntityInterface $system;

  /**
   * A conductor owned by the contributor actor.
   */
  private BbConductorInterface $ownConductor;

  /**
   * A conductor owned by someone else.
   */
  private BbConductorInterface $foreignConductor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->config('bb_core.settings')->set('protected_label_namespaces', ['runtime'])->save();
    $this->system = $this->term('label', 'runtime:system');
    $this->ownConductor = $this->conductor($this->actor);
    $this->foreignConductor = $this->conductor($this->account('other', ['skill_user']));
  }

  /**
   * A lead holds `any`: allowed on a ticket of any conductor.
   */
  public function testAnyIsAllowed(): void {
    $ticket = $this->ticket('PL-1', ['conductor_id' => $this->foreignConductor->id()]);
    $this->actAs($this->member('lead', ['lead']));
    self::assertSame([], $this->labelViolations($this->withLabel($ticket, $this->system)));
  }

  /**
   * A contributor holds `own`: allowed only where the conductor is theirs.
   */
  public function testOwnOnlyOnOwnConductor(): void {
    $own = $this->ticket('PL-2', ['conductor_id' => $this->ownConductor->id()]);
    $foreign = $this->ticket('PL-3', ['conductor_id' => $this->foreignConductor->id()]);
    $unassigned = $this->ticket('PL-4');
    self::assertSame([], $this->labelViolations($this->withLabel($own, $this->system)));
    self::assertNotSame([], $this->labelViolations($this->withLabel($foreign, $this->system)));
    self::assertNotSame([], $this->labelViolations($this->withLabel($unassigned, $this->system)));
  }

  /**
   * A member without either permission is refused, even on their conductor.
   */
  public function testNoPermissionIsRefused(): void {
    $member = $this->member('plain', ['member']);
    $ticket = $this->ticket('PL-5', ['conductor_id' => $this->conductor($member)->id()]);
    $this->actAs($member);
    self::assertNotSame([], $this->labelViolations($this->withLabel($ticket, $this->system)));
  }

  /**
   * A session-scope actor is refused, as owner and as lead.
   */
  public function testSessionActorIsRefused(): void {
    $session = $this->member('session', ['lead'], ['write bakers via session scope']);
    $ticket = $this->ticket('PL-6', ['conductor_id' => $this->conductor($session)->id()]);
    $this->actAs($session);
    self::assertNotSame([], $this->labelViolations($this->withLabel($ticket, $this->system)));
  }

  /**
   * The administer bakers permission without the grant is refused.
   */
  public function testAdministerBakersIsNotExempt(): void {
    $admin = $this->member('admin', ['member'], ['administer bakers']);
    $ticket = $this->ticket('PL-7', ['conductor_id' => $this->conductor($admin)->id()]);
    $this->actAs($admin);
    self::assertNotSame([], $this->labelViolations($this->withLabel($ticket, $this->system)));
  }

  /**
   * Removing a protected label passes; unprotected labels behave as before.
   */
  public function testRemovalAndUnprotectedLabelsPass(): void {
    $agent = $this->term('label', 'agent:claude');
    $plain = $this->term('label', 'nightly');
    $ticket = $this->ticket('PL-8', [
      'conductor_id' => $this->foreignConductor->id(),
      'labels' => [$this->system->id(), $agent->id()],
    ]);
    $this->actAs($this->member('plain', ['member']));
    $ticket->set('labels', [$agent->id(), $plain->id()]);
    self::assertSame([], $this->labelViolations($ticket));
    $ticket->set('labels', [$this->system->id(), $plain->id()]);
    self::assertSame([], $this->labelViolations($ticket), 'A label the ticket already carries is not re-checked.');
  }

  /**
   * A conductor change drops carried protected labels, keeps new ones.
   */
  public function testConductorChangeDropsCarriedProtectedLabels(): void {
    $agent = $this->term('label', 'agent:claude');
    $other = $this->term('label', 'runtime:docker');
    $ticket = $this->ticket('PL-9', [
      'conductor_id' => $this->foreignConductor->id(),
      'labels' => [$this->system->id(), $agent->id()],
    ]);
    $ticket->set('conductor_id', $this->ownConductor->id());
    $ticket->get('labels')->appendItem($other->id());
    self::assertSame([], $this->labelViolations($ticket));
    $ticket->save();
    self::assertEqualsCanonicalizing(['agent:claude', 'runtime:docker'], $this->labelNames($this->reload($ticket)));
  }

  /**
   * The ticket tools refuse a session actor.
   */
  public function testToolsRefuseSessionActor(): void {
    $session = $this->member('session', ['lead'], ['write bakers via session scope', 'create bb_ticket']);
    $ticket = $this->ticket('PL-10', ['conductor_id' => $this->conductor($session)->id()]);
    $this->actAs($session);
    $result = $this->runTool('bakers_ticket_update', [
      'ticket' => $ticket->getIdentifier(),
      'labels_add' => ['runtime:system'],
    ]);
    $this->assertFailure($result, 'protected label');
    self::assertSame([], $this->labelNames($this->reload($ticket)));
    // The create tool takes no labels: whatever it is given, none is stored.
    $result = $this->runTool('bakers_ticket_create', [
      'title' => 'Session create',
      'workflow' => 'bb_work',
      'project' => $this->project->uuid(),
      'labels' => ['runtime:system'],
    ]);
    if ($result->isSuccess()) {
      $created = $this->container->get('entity.repository')->loadEntityByUuid('bb_ticket', $result->getContextValues()['id']);
      self::assertInstanceOf(BbTicketInterface::class, $created);
      self::assertSame([], $this->labelNames($created));
    }
  }

  /**
   * The post-update grants lead `any` and contributor `own` on existing roles.
   */
  public function testPostUpdateGrantsRanks(): void {
    $any = 'set any runtime label on bb_ticket';
    $own = 'set runtime label on bb_ticket with own conductor';
    foreach (['lead', 'contributor'] as $rank) {
      $role = OgRole::load("bb_workspace-bb_workspace-$rank");
      self::assertInstanceOf(OgRole::class, $role);
      $role->revokePermission($any)->revokePermission($own)->save();
    }
    require_once __DIR__ . '/../../../bb_core.post_update.php';
    bb_core_post_update_protected_label_permissions();
    $lead = OgRole::load('bb_workspace-bb_workspace-lead');
    $contributor = OgRole::load('bb_workspace-bb_workspace-contributor');
    $member = OgRole::load('bb_workspace-bb_workspace-member');
    self::assertTrue($lead->hasPermission($any));
    self::assertFalse($lead->hasPermission($own));
    self::assertTrue($contributor->hasPermission($own));
    self::assertFalse($contributor->hasPermission($any));
    self::assertFalse($member->hasPermission($any) || $member->hasPermission($own));
  }

  /**
   * A workspace and team member with the given ranks and site permissions.
   *
   * @param string $name
   *   The account name.
   * @param array<string> $ranks
   *   Workspace rank names.
   * @param array<string> $permissions
   *   Extra site-wide permissions.
   */
  private function member(string $name, array $ranks, array $permissions = []): UserInterface {
    $roles = ['skill_user'];
    if ($permissions !== []) {
      $this->container->get('entity_type.manager')->getStorage('user_role')
        ->create(['id' => "site_$name", 'label' => $name])->save();
      user_role_grant_permissions("site_$name", $permissions);
      $roles[] = "site_$name";
    }
    $account = $this->account($name, $roles);
    $this->addMembership($this->workspace, $account, $ranks);
    $this->addMembership($this->project->get('teams')->entity, $account);
    return $account;
  }

  /**
   * Makes the account the current user.
   */
  private function actAs(UserInterface $account): void {
    $this->container->get('current_user')->setAccount($account);
  }

  /**
   * An online conductor of the project owned by the account.
   */
  private function conductor(UserInterface $owner): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $this->randomMachineName(),
      'label' => 'conductor-' . $owner->getAccountName(),
      'owner_user_id' => $owner->id(),
      'active' => TRUE,
      'status' => 'online',
      'project_id' => $this->project->id(),
    ]);
    assert($conductor instanceof BbConductorInterface);
    $conductor->save();
    return $conductor;
  }

  /**
   * The ticket with the term appended to its labels.
   */
  private function withLabel(BbTicketInterface $ticket, ContentEntityInterface $term): BbTicketInterface {
    $ticket->get('labels')->appendItem($term->id());
    return $ticket;
  }

  /**
   * The messages of violations on the labels field.
   *
   * @return array<string>
   *   The messages.
   */
  private function labelViolations(BbTicketInterface $ticket): array {
    $messages = [];
    foreach ($ticket->validate() as $violation) {
      if ($violation->getPropertyPath() === 'labels') {
        $messages[] = (string) $violation->getMessage();
      }
    }
    return $messages;
  }

  /**
   * The label names a ticket carries.
   *
   * @return array<string>
   *   The names.
   */
  private function labelNames(BbTicketInterface $ticket): array {
    return array_map(static fn ($term): string => (string) $term->label(), $ticket->get('labels')->referencedEntities());
  }

}
