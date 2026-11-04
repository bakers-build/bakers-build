<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Reads the calling user's own profile, never another user's.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class UserReadToolTest extends BakersToolTestBase {

  /**
   * The caller reads its name, position and background, empty where unset.
   */
  public function testReadsOwnProfile(): void {
    $empty = ['uuid' => $this->actor->uuid(), 'name' => 'actor', 'position' => '', 'background' => ''];
    self::assertSame($empty, $this->outputs($this->runTool('bakers_user_read', [])));

    $this->installProfileFields();
    self::assertSame($empty, $this->outputs($this->runTool('bakers_user_read', [])));
    $this->account('other')->set('field_developer_title', 'Developer')->save();
    $this->container->get('entity_type.manager')->getStorage('user')->loadUnchanged($this->actor->id())
      ->set('field_developer_title', 'Customer contact')
      ->set('field_bb_background', 'Talks with customers, who are not technical.')
      ->save();
    self::assertSame([
      'uuid' => $this->actor->uuid(),
      'name' => 'actor',
      'position' => 'Customer contact',
      'background' => 'Talks with customers, who are not technical.',
    ], $this->outputs($this->runTool('bakers_user_read', [])));
  }

  /**
   * An anonymous caller has no profile to read.
   */
  public function testRefusesAnonymous(): void {
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $this->assertFailure($this->runTool('bakers_user_read', []), 'signed-in');
  }

  /**
   * The tool takes no input, so it can name no other user.
   */
  public function testTakesNoInput(): void {
    $definition = $this->container->get('plugin.manager.tool')->getDefinition('bakers_user_read');
    self::assertSame([], $definition->getInputDefinitions());
  }

  /**
   * Installs the two profile fields from config/sync, where they live.
   */
  private function installProfileFields(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    foreach (['field_developer_title', 'field_bb_background'] as $name) {
      $storageData = $storage->read("field.storage.user.$name");
      self::assertIsArray($storageData);
      FieldStorageConfig::create($storageData)->save();
      $fieldData = $storage->read("field.field.user.user.$name");
      self::assertIsArray($fieldData);
      FieldConfig::create($fieldData)->save();
    }
  }

}
