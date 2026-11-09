<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\user\Entity\User;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * The shipped key list shows the path user's own managed keys only.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ApiKeyListingTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'state_machine',
    'consumers', 'simple_oauth', 'views', 'path_alias', 'bb_core', 'bb_api_key',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('path_alias');
    $this->installConfig(['user', 'simple_oauth']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();
    $data = Yaml::decode((string) file_get_contents(DRUPAL_ROOT . '/../config/sync/views.view.bb_api_keys.yml'));
    // The page's layout extender belongs to display_builder, not under test.
    unset($data['display']['page']['display_options']['display_extenders']);
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
  }

  /**
   * Another account's keys and ordinary consumers never appear.
   */
  public function testListIsScopedToThePathUser(): void {
    $this->createUser();
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $other = $this->createUser();
    self::assertInstanceOf(User::class, $other);
    $manager = $this->container->get(ApiKeyManager::class);
    $expires = $this->container->get('datetime.time')->getCurrentTime() + 86400;
    $manager->create($owner, 'Mine', $expires);
    $manager->create($other, 'Theirs', $expires);
    $this->container->get('entity_type.manager')->getStorage('consumer')->create([
      'client_id' => 'bakers-legacy',
      'label' => 'Legacy',
      'secret' => 's',
      'owner_id' => $owner->id(),
      'user_id' => $owner->id(),
      'confidential' => TRUE,
      'grant_types' => ['client_credentials'],
    ])->save();

    $this->setCurrentUser($owner);
    // The default-user argument reads the user from the page path.
    $this->container->get('request_stack')->push(Request::create('/user/' . $owner->id() . '/api-keys'));
    $view = Views::getView('bb_api_keys');
    self::assertNotNull($view);
    $view->setDisplay('page');
    $view->setArguments([(string) $owner->id()]);
    $view->execute();
    $this->container->get('request_stack')->pop();

    $labels = array_map(static fn ($row): string => (string) $row->_entity->label(), $view->result);
    self::assertSame(['Mine'], $labels);
  }

  /**
   * Revoke opens the confirm dialog over the list; the href is the page.
   */
  public function testRevokeOpensTheDialogOverTheList(): void {
    $this->createUser();
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $key = $this->container->get(ApiKeyManager::class)->create($owner, 'Mine', $this->container->get('datetime.time')->getCurrentTime() + 86400)['consumer'];
    $this->setCurrentUser($owner);
    $list = '/user/' . $owner->id() . '/api-keys';
    $this->container->get('request_stack')->push(Request::create($list));
    $view = Views::getView('bb_api_keys');
    self::assertNotNull($view);
    $view->setDisplay('page');
    $view->setArguments([(string) $owner->id()]);
    $view->execute();
    $link = $view->field['bb_api_key_revoke_link']->render($view->result[0]);
    $this->container->get('request_stack')->pop();

    self::assertIsArray($link, 'a link render array for the owner\'s own key');
    $url = $link['#url'];
    $delete = $list . '/' . $key->id() . '/delete';
    self::assertSame($delete, $url->toString());
    $attributes = $url->getOption('attributes');
    self::assertStringStartsWith($delete . '?', $attributes['data-hx-get']);
    parse_str((string) parse_url($attributes['data-hx-get'], PHP_URL_QUERY), $query);
    self::assertSame(['destination' => $list, '_wrapper_format' => 'island_dialog'], $query);
    self::assertSame('#bakers-overlay', $attributes['data-hx-target']);
  }

}
