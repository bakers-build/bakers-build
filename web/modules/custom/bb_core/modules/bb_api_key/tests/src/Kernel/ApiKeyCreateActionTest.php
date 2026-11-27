<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * A key list offers exactly one `Create API key` plus, for whose list it is.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ApiKeyCreateActionTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og',
    'consumers', 'simple_oauth', 'views', 'path_alias', 'island', 'ui_patterns', 'bb_core', 'bb_api_key',
  ];

  /**
   * The workspace lead who owns keys and manages the service account.
   */
  private UserInterface $lead;

  /**
   * A service account of the workspace.
   */
  private UserInterface $serviceAccount;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $types = [
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group',
      'bb_project', 'consumer', 'oauth2_token', 'path_alias',
    ];
    foreach ($types as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'og', 'bb_core', 'bb_api_key', 'simple_oauth']);
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

    $this->createUser([], 'uid1-dummy');
    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $team = $storage->getStorage('bb_team')->create(['name' => 'API home', 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->lead = $lead;
    $lead_role = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertInstanceOf(OgRole::class, $lead_role);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($lead)
      ->setGroup($workspace)
      ->setRoles([$lead_role])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    $manager = $this->container->get(ServiceAccountManager::class);
    self::assertInstanceOf(ServiceAccountManager::class, $manager);
    $this->serviceAccount = $manager->create($workspace, $team, 'incident-bot', 'guest', 'reporter', date('Y-m-d', strtotime('+30 days')), $lead)['user'];

    foreach (['views.view.bb_api_keys', 'views.view.bb_service_accounts'] as $name) {
      $data = Yaml::decode((string) file_get_contents(DRUPAL_ROOT . '/../config/sync/' . $name . '.yml'));
      foreach (array_keys($data['display']) as $display) {
        unset($data['display'][$display]['display_options']['display_extenders']);
      }
      $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
    }
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * An owner's own list offers the owner's form only.
   */
  public function testTheOwnersListOffersTheOwnersForm(): void {
    $this->setCurrentUser($this->lead);
    $triggers = $this->triggersOnTheKeyListOf($this->lead);
    self::assertSame(['bb_api_key.create.key'], array_keys($triggers));
    self::assertStringContainsString('/user/' . $this->lead->id() . '/api-keys/add', $triggers['bb_api_key.create.key']['#props']['href']);
  }

  /**
   * A service account's list offers its workspace's key route only.
   */
  public function testServiceAccountListOffersItsWorkspaceRoute(): void {
    $this->setCurrentUser($this->lead);
    $triggers = $this->triggersOnTheKeyListOf($this->serviceAccount);
    self::assertSame(['bb_api_key.create.service_account_key'], array_keys($triggers));
    self::assertStringContainsString('/acme/service-accounts/' . $this->serviceAccount->id() . '/keys/add', $triggers['bb_api_key.create.service_account_key']['#props']['href']);
  }

  /**
   * Who may not issue a service account's keys gets no plus on its list.
   */
  public function testStrangerGetsNoPlusOnServiceAccountList(): void {
    $stranger = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $stranger);
    $this->setCurrentUser($stranger);
    $build = $this->build($this->serviceAccount);
    self::assertSame([], $this->children($build));
    self::assertContains('route', $build['#cache']['contexts']);
  }

  /**
   * The triggers on a user's key list, by local action id.
   *
   * @return array<string, array<string, mixed>>
   *   The triggers.
   */
  private function triggersOnTheKeyListOf(UserInterface $listed): array {
    return $this->children($this->build($listed));
  }

  /**
   * The create source rendered on a user's key list, as the router matches it.
   *
   * @return array<string, mixed>
   *   The build.
   */
  private function build(UserInterface $listed): array {
    $request = Request::create('/user/' . $listed->id() . '/api-keys');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add($this->container->get('router.no_access_checks')->matchRequest($request));
    self::assertSame('view.bb_api_keys.page', $request->attributes->get('_route'));
    $this->container->get('request_stack')->push($request);
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance('bb_create_action', SourcePluginBase::buildConfiguration('actions', $schema, ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    try {
      return $source->getPropValue();
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * A build's triggers, keyed by local action id.
   *
   * @param array<string, mixed> $build
   *   The build.
   *
   * @return array<string, array<string, mixed>>
   *   The triggers.
   */
  private function children(array $build): array {
    return array_filter($build, static fn (string $key): bool => !str_starts_with($key, '#'), ARRAY_FILTER_USE_KEY);
  }

}
