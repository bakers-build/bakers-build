<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\user\UserInterface;

/**
 * Installs and submits the user Profile form (position and background).
 */
trait UserProfileTestTrait {

  /**
   * Installs the profile fields, form mode and form display from config/sync.
   *
   * They live only at the repository's top level, so `installConfig`
   * cannot reach them.
   */
  protected function installUserProfileConfig(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $entityTypeManager = $this->container->get('entity_type.manager');
    foreach ([
      ['field_storage_config', 'field.storage.user.field_developer_title'],
      ['field_config', 'field.field.user.user.field_developer_title'],
      ['field_storage_config', 'field.storage.user.field_bb_background'],
      ['field_config', 'field.field.user.user.field_bb_background'],
      ['entity_form_mode', 'core.entity_form_mode.user.profile'],
      ['entity_form_display', 'core.entity_form_display.user.user.profile'],
    ] as [$type, $name]) {
      $data = $storage->read($name);
      self::assertIsArray($data, "config/sync/$name.yml exists.");
      $entityTypeManager->getStorage($type)->create($data)->save();
    }
  }

  /**
   * Presses Save on the Profile form of a user, as the current account.
   */
  protected function submitUserProfile(UserInterface $user, string $position, string $background): FormStateInterface {
    $form = $this->container->get('entity_type.manager')->getFormObject('user', 'profile');
    $form->setEntity($user);
    $formState = (new FormState())->setValues([
      'field_developer_title' => [['value' => $position]],
      'field_bb_background' => [['value' => $background]],
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm($form, $formState);
    return $formState;
  }

  /**
   * Reloads a user's stored position and background.
   *
   * @return array{0: ?string, 1: ?string}
   *   Position and background as stored.
   */
  protected function storedUserProfile(UserInterface $user): array {
    $stored = $this->container->get('entity_type.manager')->getStorage('user')->loadUnchanged($user->id());
    self::assertInstanceOf(UserInterface::class, $stored);
    return [$stored->get('field_developer_title')->value, $stored->get('field_bb_background')->value];
  }

}
