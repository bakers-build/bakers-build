<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\DetailActionsTestTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * An API key has its own detail in its owner's area, with Revoke.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ApiKeyDetailTest extends KernelTestBase {

  use UserCreationTrait;
  use DetailActionsTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og', 'consumers', 'simple_oauth',
    'views', 'path_alias', 'ui_patterns', 'block', 'ui_patterns_field', 'display_builder', 'display_builder_entity_view', 'island', 'bb_core', 'bb_api_key',
  ];

  /**
   * The key owner.
   */
  private UserInterface $owner;

  /**
   * The owner's key.
   */
  private ConsumerInterface $key;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project', 'consumer', 'path_alias'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'og', 'bb_core', 'bb_api_key', 'simple_oauth']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();
    $this->createUser();
    $owner = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $owner);
    $this->owner = $owner;
    $this->setCurrentUser($owner);
    $this->key = $this->container->get(ApiKeyManager::class)->create($owner, 'Pipeline', $this->container->get('datetime.time')->getCurrentTime() + 86400)['consumer'];
  }

  /**
   * The detail is the owner's alone, at the key's place in their area.
   */
  public function testDetailIsTheOwnersAlone(): void {
    $url = Url::fromRoute('bb_api_key.view', ['user' => $this->owner->id(), 'consumer' => $this->key->id()]);
    self::assertSame('/user/' . $this->owner->id() . '/api-keys/' . $this->key->id(), $url->toString());
    self::assertTrue($url->access($this->owner));

    $stranger = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $stranger);
    self::assertFalse($url->access($stranger), 'another account');
    $this->setCurrentUser($stranger);
    $theirs = $this->container->get(ApiKeyManager::class)->create($stranger, 'Theirs', $this->container->get('datetime.time')->getCurrentTime() + 86400)['consumer'];
    self::assertFalse(Url::fromRoute('bb_api_key.view', ['user' => $this->owner->id(), 'consumer' => $theirs->id()])->access($this->owner), 'a foreign key in the own area');
  }

  /**
   * The detail shows the key, then Revoke; nobody else gets the action.
   */
  public function testDetailOffersRevokeToTheOwnerOnly(): void {
    $this->setCurrentUser($this->owner);
    $revoke = '/user/' . $this->owner->id() . '/api-keys/' . $this->key->id() . '/delete';

    $actions = $this->detailActions('bb_api_key_actions', $this->key);

    self::assertSame(['revoke'], array_keys($actions));
    self::assertSame($revoke, $actions['revoke']['#props']['href']);
    self::assertSame('Revoke', $actions['revoke']['#props']['label']);

    $html = $this->renderDetail();
    self::assertStringContainsString('Created', $html);
    self::assertStringContainsString('Expires', $html);
    self::assertStringContainsString('Active', $html);
    self::assertGreaterThan(strpos($html, 'Expires'), strpos($html, '>Revoke<'));

    $stranger = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $stranger);
    $this->setCurrentUser($stranger);
    self::assertSame([], $this->detailActions('bb_api_key_actions', $this->key));
  }

  /**
   * Renders the key with the shipped display.
   */
  private function renderDetail(): string {
    $this->installConfig(['display_builder']);
    $name = 'core.entity_view_display.consumer.consumer.default';
    $data = Yaml::decode((string) file_get_contents(dirname(DRUPAL_ROOT) . '/recipes/bakers/config/' . $name . '.yml'));
    $data['uuid'] = $this->container->get('uuid')->generate();
    $this->container->get('config.storage')->write($name, $data);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $build = $this->container->get('entity_type.manager')->getViewBuilder('consumer')->view($this->key, 'full');
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

}
