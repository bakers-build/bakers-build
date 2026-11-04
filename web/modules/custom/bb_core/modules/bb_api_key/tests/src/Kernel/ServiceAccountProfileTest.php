<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\UserProfileTestTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A workspace lead edits a service account's position and background.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ServiceAccountProfileTest extends KernelTestBase {

  use UserCreationTrait;
  use UserProfileTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og',
    'consumers', 'simple_oauth', 'views', 'bb_core', 'bb_api_key',
  ];

  /**
   * The workspace the lead administers.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * A team inside the workspace.
   */
  private BbTeamInterface $team;

  /**
   * The workspace's lead.
   */
  private UserInterface $lead;

  /**
   * An active service account of the workspace.
   */
  private UserInterface $service;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_comment', 'bb_run', 'bb_term', 'consumer', 'oauth2_token',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'og', 'bb_core', 'bb_api_key', 'simple_oauth']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();
    $this->installUserProfileConfig();
    Og::addGroup('bb_workspace', 'bb_workspace');
    Og::addGroup('bb_team', 'bb_team');
    // UID 1 dummy so no test account is the superuser.
    $this->createUser([], 'uid1-dummy');

    $this->workspace = $this->workspace('acme');
    $this->team = $this->team($this->workspace);
    $this->lead = $this->leadOf($this->workspace);
    $this->service = $this->serviceAccount('profile-bot');
  }

  /**
   * Creates a workspace.
   */
  private function workspace(string $slug): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create([
      'name' => $slug,
      'slug' => $slug,
    ]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    return $workspace;
  }

  /**
   * Creates a team in a workspace.
   */
  private function team(BbWorkspaceInterface $workspace): BbTeamInterface {
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')->create([
      'name' => $workspace->label() . ' team',
      'workspace_id' => $workspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    return $team;
  }

  /**
   * Creates a user with the workspace's `lead` rank.
   */
  private function leadOf(BbWorkspaceInterface $workspace): UserInterface {
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $role = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertInstanceOf(OgRole::class, $role);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($lead)
      ->setGroup($workspace)
      ->setRoles([$role])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    return $lead;
  }

  /**
   * Creates an active service account in the lead's workspace.
   */
  private function serviceAccount(string $name): UserInterface {
    $manager = $this->container->get(ServiceAccountManager::class);
    self::assertInstanceOf(ServiceAccountManager::class, $manager);
    $expires = date('Y-m-d', $this->container->get('datetime.time')->getCurrentTime() + 86400 * 10);
    return $manager->create($this->workspace, $this->team, $name, 'guest', 'reporter', $expires, $this->lead)['user'];
  }

  /**
   * The lead saves and clears the profile; the run prompt follows it.
   */
  public function testLeadEditsTheProfileAndTheRunPromptFollows(): void {
    $this->setCurrentUser($this->lead);
    self::assertTrue($this->service->access('edit profile', $this->lead));
    self::assertFalse($this->service->access('update', $this->lead), 'no access to mail, password or the edit form');

    $formState = $this->submitUserProfile($this->service, 'Release bot', 'Ships tagged builds');
    self::assertSame([], $formState->getErrors());
    self::assertSame(['Release bot', 'Ships tagged builds'], $this->storedUserProfile($this->service));

    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create(['name' => 'profile-project']);
    $project->save();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'Assigned to the bot',
      'workflow' => 'bb_work',
      'project_id' => $project->id(),
      'assignee_user_id' => $this->service->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $profile = (string) $ticket->get('recipient_profile')->value;
    self::assertStringContainsString("Position: Release bot\n", $profile);
    self::assertStringContainsString('Ships tagged builds', $profile);

    $formState = $this->submitUserProfile($this->service, '', '');
    self::assertSame([], $formState->getErrors());
    self::assertSame([NULL, NULL], $this->storedUserProfile($this->service));
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    self::assertSame('', (string) $reloaded->get('recipient_profile')->value);
  }

  /**
   * A foreign lead, an ordinary member, and a disabled account are denied.
   */
  public function testEditProfileDenied(): void {
    $foreign = $this->workspace('other');
    $foreignLead = $this->leadOf($foreign);
    self::assertFalse($this->service->access('edit profile', $foreignLead), 'a lead of another workspace');

    $member = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $member);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($member)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    self::assertFalse($this->service->access('edit profile', $member), 'an ordinary member');
    self::assertFalse($member->access('edit profile', $this->lead), 'a lead on a human of the workspace');

    $disabled = $this->serviceAccount('retired-bot');
    $manager = $this->container->get(ServiceAccountManager::class);
    self::assertInstanceOf(ServiceAccountManager::class, $manager);
    $manager->disable($disabled, $this->lead);
    $disabled = $this->container->get('entity_type.manager')->getStorage('user')->loadUnchanged($disabled->id());
    self::assertInstanceOf(UserInterface::class, $disabled);
    self::assertFalse($disabled->access('edit profile', $this->lead), 'a disabled service account');
  }

}
