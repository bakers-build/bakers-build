<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The workspace delete form: slug confirmation, blockers and landing.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceDeleteFormTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og', 'bb_core',
  ];

  /**
   * The workspace owner.
   */
  private UserInterface $owner;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project', 'bb_invite'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->config('og.settings')->set('group_manager_full_access', FALSE)->save();
    $this->container->get('router.builder')->rebuild();
    // Uid 1 bypasses every access check, so it is never an actor here.
    $this->createUser([], 'uid1-dummy');
    $owner = $this->createUser([], 'owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $this->owner = $owner;
    $this->setCurrentUser($owner);
  }

  /**
   * A workspace as provisioning leaves it: the owner leads it and its team.
   */
  private function provision(): BbWorkspaceInterface {
    return $this->container->get('bb_core.workspace_provisioner')->provision('Mistake', $this->owner, 'First crew');
  }

  /**
   * Submits the delete form with the given slug.
   */
  private function submit(BbWorkspaceInterface $workspace, string $slug): FormStateInterface {
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_workspace', 'delete');
    $form_object->setEntity($workspace);
    $form_state = (new FormState())->setValue('confirm_slug', $slug);
    $this->container->get('form_builder')->submitForm($form_object, $form_state);
    return $form_state;
  }

  /**
   * The number of rows of an entity type, read past any cache.
   */
  private function rows(string $type): int {
    return (int) $this->container->get('entity_type.manager')->getStorage($type)->getQuery()->accessCheck(FALSE)->count()->execute();
  }

  /**
   * A wrong or empty slug deletes nothing and flags the field.
   */
  public function testWrongSlugDeletesNothing(): void {
    $workspace = $this->provision();
    foreach (['', 'wrong', ' MISTAKE '] as $slug) {
      $form_state = $this->submit($workspace, $slug);
      self::assertArrayHasKey('confirm_slug', $form_state->getErrors(), "slug '$slug' is refused");
    }
    self::assertSame(1, $this->rows('bb_workspace'));
    self::assertSame(1, $this->rows('bb_team'));
  }

  /**
   * The slug deletes the workspace, its first team and every membership.
   */
  public function testSlugDeletesTheProvisionedWorkspace(): void {
    $workspace = $this->provision();
    self::assertGreaterThan(0, $this->rows('og_membership'));

    $form_state = $this->submit($workspace, ' ' . $workspace->getSlug() . ' ');

    self::assertSame([], $form_state->getErrors());
    self::assertSame(0, $this->rows('bb_workspace'));
    self::assertSame(0, $this->rows('bb_team'));
    self::assertSame(0, $this->rows('og_membership'));
    // A programmed submit reports no redirect; a real post gets this one.
    $redirect = $form_state->setProgrammed(FALSE)->getRedirect();
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame('bb_core.home', $redirect->getRouteName());
    $messages = $this->container->get('messenger')->messagesByType('status');
    self::assertSame(['Deleted Mistake.'], array_map(fn($m) => strip_tags((string) $m), $messages));
  }

  /**
   * A group blocks: no slug field, no confirm button, a slug changes nothing.
   */
  public function testGroupBlocksTheDelete(): void {
    $workspace = $this->provision();
    $this->container->get('entity_type.manager')->getStorage('bb_group')->create([
      'name' => 'Clients',
      'workspace_id' => $workspace->id(),
    ])->save();

    $form = $this->container->get('entity.form_builder')->getForm($workspace, 'delete');
    self::assertArrayNotHasKey('confirm_slug', $form);
    self::assertFalse($form['actions']['submit']['#access']);
    self::assertStringContainsString("can't be deleted", strip_tags((string) $form['consequences']['blocked']['#slots']['body']['sentence']['#markup']));

    $this->submit($workspace, $workspace->getSlug());
    self::assertSame(1, $this->rows('bb_workspace'));
  }

  /**
   * Settings shows the owner a danger zone; another lead sees none.
   */
  public function testSettingsDangerZoneIsTheOwners(): void {
    $workspace = $this->provision();
    $form = $this->container->get('entity.form_builder')->getForm($workspace, 'settings');
    self::assertArrayNotHasKey('delete', $form['actions']);
    self::assertArrayHasKey('danger_zone', $form);
    self::assertSame('bb_theme:danger_zone', $form['danger_zone']['#component']);
    $button = $form['danger_zone']['#slots']['action']['delete'];
    self::assertSame('Delete workspace', (string) $button['#props']['label']);
    self::assertSame('danger', $button['#props']['variant']);
    self::assertSame($workspace->toUrl('delete-form')->toString(), $button['#props']['href']);

    $lead = $this->createUser([], 'other-lead');
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_workspace')->resetCache();
    $form = $this->container->get('entity.form_builder')->getForm($workspace, 'settings');
    self::assertArrayNotHasKey('danger_zone', $form);
    self::assertArrayNotHasKey('delete', $form['actions']);
  }

  /**
   * Project, group and team Settings put Delete in a danger zone.
   */
  public function testProjectGroupAndTeamDeleteSitInTheDangerZone(): void {
    $workspace = $this->provision();
    $etm = $this->container->get('entity_type.manager');
    $group = $etm->getStorage('bb_group')->create(['name' => 'Clients', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = current($etm->getStorage('bb_team')->loadByProperties(['workspace_id' => $workspace->id()]));
    self::assertInstanceOf(EntityInterface::class, $team);
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'Site',
      'key' => 'SITE',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $project->save();

    // Placement only; who may delete a project or team is covered elsewhere.
    $admin = $this->createUser(['administer bakers'], 'site-admin');
    self::assertInstanceOf(UserInterface::class, $admin);
    $this->setCurrentUser($admin);
    foreach ([[$project, 'settings'], [$group, 'settings'], [$team, 'settings']] as [$entity, $operation]) {
      $form = $this->container->get('entity.form_builder')->getForm($entity, $operation);
      $type = $entity->getEntityTypeId();
      self::assertArrayNotHasKey('delete', $form['actions'] ?? [], "$type: no Delete in the action row");
      self::assertSame('bb_theme:danger_zone', $form['danger_zone']['#component'] ?? NULL, "$type: danger zone");
      $button = $form['danger_zone']['#slots']['action']['delete'];
      self::assertSame('danger', $button['#props']['variant']);
      self::assertSame($entity->toUrl('delete-form')->toString(), $button['#props']['href']);
    }
    // The team's identity card only shows it now: no input, no Save, no Delete.
    $card = $this->container->get('entity.form_builder')->getForm($team, 'identity');
    self::assertArrayNotHasKey('danger_zone', $card);
    self::assertArrayNotHasKey('submit', $card['actions'] ?? []);
    self::assertArrayNotHasKey('name', $card);
  }

  /**
   * A non-owner lead sees no project/group danger zone unless they created it.
   */
  public function testProjectAndGroupDangerZoneIsTheCreatorsOrOwners(): void {
    $workspace = $this->provision();
    $etm = $this->container->get('entity_type.manager');
    // Created by someone else, so the owner passes as owner, not as creator.
    $creator = $this->createUser([], 'creator');
    self::assertInstanceOf(UserInterface::class, $creator);
    $group = $etm->getStorage('bb_group')->create([
      'name' => 'Clients',
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $creator->id(),
    ]);
    $group->save();
    $team = current($etm->getStorage('bb_team')->loadByProperties(['workspace_id' => $workspace->id()]));
    self::assertInstanceOf(EntityInterface::class, $team);
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'Site',
      'key' => 'SITE',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
      'owner_user_id' => $creator->id(),
    ]);
    $project->save();

    // The workspace owner deletes what someone else created.
    foreach ([$project, $group] as $entity) {
      $form = $this->container->get('entity.form_builder')->getForm($entity, 'settings');
      self::assertArrayHasKey('danger_zone', $form, $entity->getEntityTypeId() . ': owner sees the danger zone');
    }

    $lead = $this->createUser([], 'other-lead');
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    foreach ([$project, $group] as $entity) {
      self::assertInstanceOf(ContentEntityInterface::class, $entity);
      $type = $entity->getEntityTypeId();
      $etm->getAccessControlHandler($type)->resetCache();
      $form = $this->container->get('entity.form_builder')->getForm($entity, 'settings');
      self::assertArrayNotHasKey('danger_zone', $form, "$type: a non-owner lead sees none");
      self::assertArrayNotHasKey('delete', $form['actions'] ?? [], "$type: nor a Delete action");

      $entity->set('owner_user_id', $lead->id())->save();
      $etm->getAccessControlHandler($type)->resetCache();
      $form = $this->container->get('entity.form_builder')->getForm($entity, 'settings');
      self::assertArrayHasKey('danger_zone', $form, "$type: its creator does");
    }
  }

}
