<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\consumers\Entity\Consumer;
use Drupal\Core\Config\FileStorage;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\file\Entity\File;
use Drupal\KernelTests\KernelTestBase;
use Drupal\simple_oauth\Authentication\TokenAuthUser;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Entity\Oauth2Scope;
use Drupal\simple_oauth\Entity\Oauth2TokenInterface;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\Entity\Role;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A bb:session sign-in sets its own picture and no one else's.
 *
 * The token is user-bound (device code), so its permissions are the user's
 * intersected with the shipped bb:session children, read from config/sync.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class OwnPictureSessionTokenTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'file', 'image', 'field', 'options', 'entity',
    'state_machine', 'og', 'link', 'text', 'filter', 'serialization',
    'path_alias', 'consumers', 'simple_oauth', 'bb_oauth_device', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'file', 'consumer', 'oauth2_token', 'og_membership', 'bb_workspace'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['user', 'consumers', 'simple_oauth']);

    $sync = new FileStorage(dirname($this->root) . '/config/sync');
    $this->container->get('config.typed')->clearCachedDefinitions();
    $authenticated = $sync->read('user.role.authenticated');
    self::assertIsArray($authenticated);
    Role::load('authenticated')?->delete();
    Role::create($authenticated)->save();
    foreach (['field.storage.user.user_picture', 'field.field.user.user.user_picture'] as $name) {
      $data = $sync->read($name);
      self::assertIsArray($data);
      str_starts_with($name, 'field.storage.') ? FieldStorageConfig::create($data)->save() : FieldConfig::create($data)->save();
    }
    // Umbrella first: children name it as their parent.
    $scopes = $sync->listAll('simple_oauth.oauth2_scope.bb_session');
    sort($scopes);
    foreach ($scopes as $name) {
      $data = $sync->read($name);
      self::assertIsArray($data);
      Oauth2Scope::create($data)->save();
    }

    // Uid 1 is a superuser; consume it so every actor below is ordinary.
    $this->createUser();
  }

  /**
   * The signed-in person attaches a freshly uploaded public picture.
   */
  public function testSessionTokenSetsOwnPicture(): void {
    $own = $this->createUser([], 'own');
    self::assertInstanceOf(UserInterface::class, $own);
    $token_user = $this->sessionTokenAccount($own);
    $this->container->get('current_user')->setAccount($token_user);

    self::assertTrue($own->access('update', $token_user));
    $own->set('user_picture', $this->uploadedPicture($own)->id());
    $violations = $own->validate()->getByField('user_picture');
    self::assertCount(0, $violations, (string) $violations);
  }

  /**
   * Another account's picture stays out of reach.
   */
  public function testSessionTokenCannotSetForeignPicture(): void {
    $own = $this->createUser([], 'own');
    $other = $this->createUser([], 'other');
    self::assertInstanceOf(UserInterface::class, $own);
    self::assertInstanceOf(UserInterface::class, $other);
    $token_user = $this->sessionTokenAccount($own);
    $this->container->get('current_user')->setAccount($token_user);

    self::assertFalse($other->access('update', $token_user));
  }

  /**
   * A temporary public image owned by $owner, as upload-file creates it.
   */
  private function uploadedPicture(UserInterface $owner): File {
    $uri = 'public://avatar.png';
    file_put_contents($uri, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='));
    $file = File::create(['uri' => $uri, 'uid' => $owner->id()]);
    $file->setTemporary();
    $file->save();
    return $file;
  }

  /**
   * A real user-bound bb:session token, as the device-code sign-in mints it.
   */
  private function sessionTokenAccount(UserInterface $user): TokenAuthUserInterface {
    $consumer = Consumer::create([
      'client_id' => 'bakers-cli',
      'label' => 'bakers CLI',
      'confidential' => FALSE,
      'grant_types' => ['urn:ietf:params:oauth:grant-type:device_code'],
      'scopes' => ['bb_session'],
    ]);
    $consumer->save();
    $token = $this->container->get('entity_type.manager')->getStorage('oauth2_token')->create([
      'bundle' => 'access_token',
      'auth_user_id' => $user->id(),
      'client' => $consumer->id(),
      'scopes' => ['bb_session'],
      'value' => 'session-token-' . $user->id(),
      'expire' => time() + 3600,
      'status' => TRUE,
    ]);
    self::assertInstanceOf(Oauth2TokenInterface::class, $token);
    $token->save();
    return new TokenAuthUser(
      $this->container->get('permission_checker'),
      $token,
      $this->container->get('psr7.http_message_factory'),
      $this->container->get('request_stack'),
    );
  }

}
