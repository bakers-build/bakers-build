<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Component\Utility\Html;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Service Accounts listing is exact and leaks no secret.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ServiceAccountListingTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og',
    'consumers', 'simple_oauth', 'views', 'path_alias', 'bb_core', 'bb_api_key',
  ];

  /**
   * The workspace the listing is scoped to.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * A second, unrelated workspace.
   */
  private BbWorkspaceInterface $foreignWorkspace;

  /**
   * A team inside `$workspace`.
   */
  private BbTeamInterface $team;

  /**
   * An account with the workspace's `lead` rank.
   */
  private UserInterface $lead;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installEntitySchema('path_alias');
    $this->installConfig(['system', 'user', 'og', 'bb_core', 'bb_api_key', 'simple_oauth']);
    // The listing's row is composed of the THEME's own `bb_theme:badge`
    // component (ServiceAccountKeys), which core's default test theme does
    // not provide — see CreateDialogSharedOriginTest for the same need.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();

    Og::addGroup('bb_workspace', 'bb_workspace');
    Og::addGroup('bb_team', 'bb_team');

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_workspace');
    $workspace = $storage->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $this->workspace = $workspace;

    $foreign = $storage->create(['name' => 'Other', 'slug' => 'other']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $foreign);
    $foreign->save();
    $this->foreignWorkspace = $foreign;

    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')->create([
      'name' => 'API home',
      'workspace_id' => $this->workspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    $this->team = $team;

    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->lead = $lead;
    $leadRole = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertInstanceOf(OgRole::class, $leadRole);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($this->lead)
      ->setGroup($this->workspace)
      ->setRoles([$leadRole])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $data = Yaml::decode((string) file_get_contents(DRUPAL_ROOT . '/../config/sync/views.view.bb_service_accounts.yml'));
    unset($data['display']['settings']['display_options']['display_extenders']);
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
    // Its row menu links to the shipped API keys page.
    $keys = Yaml::decode((string) file_get_contents(DRUPAL_ROOT . '/../config/sync/views.view.bb_api_keys.yml'));
    unset($keys['display']['page']['display_options']['display_extenders']);
    $this->container->get('entity_type.manager')->getStorage('view')->create($keys)->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The lifecycle manager, to set up fixture service accounts.
   */
  private function manager(): ServiceAccountManager {
    $manager = $this->container->get(ServiceAccountManager::class);
    self::assertInstanceOf(ServiceAccountManager::class, $manager);
    return $manager;
  }

  /**
   * Only this workspace's own service accounts ever appear in its list.
   *
   * A human member, another workspace's service account, and a disabled
   * account of THIS workspace are all exercised: the first two must never
   * appear, the disabled one must still be listed (Disabled rows stay
   * visible; only key issuance is denied for them).
   */
  public function testListIsScopedToTheArgumentWorkspaceAndIncludesDisabled(): void {
    $expires = date('Y-m-d', $this->container->get('datetime.time')->getCurrentTime() + 86400 * 10);
    $own = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $expires, $this->lead);

    $foreignTeam = $this->container->get('entity_type.manager')->getStorage('bb_team')->create([
      'name' => 'Other team',
      'workspace_id' => $this->foreignWorkspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $foreignTeam);
    $foreignTeam->save();
    $foreignLead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $foreignLead);
    $foreignLeadRole = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertInstanceOf(OgRole::class, $foreignLeadRole);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($foreignLead)
      ->setGroup($this->foreignWorkspace)
      ->setRoles([$foreignLeadRole])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    $this->manager()->create($this->foreignWorkspace, $foreignTeam, 'foreign-bot', 'guest', 'reporter', $expires, $foreignLead);

    $disabled = $this->manager()->create($this->workspace, $this->team, 'retired-bot', 'guest', 'reporter', $expires, $this->lead);
    $this->manager()->disable($disabled['user'], $this->lead);

    // A human member of the same workspace: the marker argument excludes it
    // without any extra filter.
    $this->createUser();

    $this->setCurrentUser($this->lead);
    $view = Views::getView('bb_service_accounts');
    self::assertNotNull($view);
    $view->setDisplay('settings');
    $view->setArguments([$this->workspace->getSlug()]);
    $view->execute();

    $names = array_map(static fn ($row): string => (string) $row->_entity->label(), $view->result);
    sort($names);
    self::assertSame(
      [$own['user']->getAccountName(), $disabled['user']->getAccountName()],
      $names,
    );

    $build = $view->buildRenderable('settings', [$this->workspace->getSlug()]);
    $rendered = (string) $this->container->get('renderer')->renderInIsolation($build);
    self::assertStringNotContainsString($own['secret'], $rendered, 'The one-time secret must never be serialized into the listing.');
    self::assertStringNotContainsString($disabled['secret'], $rendered);
    self::assertStringContainsString('Guest', $rendered, 'the workspace role must be listed');
    self::assertStringContainsString('1 key · until ', $rendered, 'each account must summarize its keys');
    self::assertStringContainsString('Manage API keys', $rendered, 'an active account must link to its API keys page');
    self::assertStringContainsString('Disable', $rendered, 'an active account must offer Disable');
    $profile = Url::fromRoute('bb_core.user.profile', ['user' => $own['user']->id()], [
      'query' => ['destination' => Url::fromRoute('view.bb_service_accounts.settings', ['bb_workspace' => $this->workspace->getSlug()])->toString()],
    ])->toString();
    $profileAt = strpos($rendered, Html::escape($profile));
    self::assertIsInt($profileAt, 'an active account must link to its Profile, returning to this list');
    self::assertLessThan(strpos($rendered, 'Manage API keys'), $profileAt, 'Profile comes first');
    self::assertStringNotContainsString('/user/' . $disabled['user']->id() . '/profile', $rendered, 'a disabled account offers no Profile');
  }

  /**
   * An empty/missing workspace argument closes the list, never shows "all".
   */
  public function testEmptyArgumentIsClosedNotAll(): void {
    $expires = date('Y-m-d', $this->container->get('datetime.time')->getCurrentTime() + 86400 * 10);
    $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $expires, $this->lead);

    $this->setCurrentUser($this->lead);
    $view = Views::getView('bb_service_accounts');
    self::assertNotNull($view);
    $view->setDisplay('settings');
    $view->setArguments(['']);
    $view->execute();

    self::assertSame([], $view->result, 'An empty workspace argument must fail closed, not list every service account.');
  }

}
