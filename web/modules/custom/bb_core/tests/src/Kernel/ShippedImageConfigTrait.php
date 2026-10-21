<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Symfony\Component\Yaml\Yaml;

/**
 * Installs the recipe-shipped config the entity image crop depends on.
 *
 * The project, group and workspace form displays use bb_image's
 * `bb_square_image` widget and the avatar image style applies Crop API's
 * effect; bb_core depends on neither module, so all of it ships from
 * `recipes/bakers/config` and `config/sync` rather than the module, and
 * `installConfig(['bb_core'])` creates none of it. The file on disk is the
 * source, never a copy in a test.
 */
trait ShippedImageConfigTrait {

  /**
   * Creates the project, group and workspace form displays.
   *
   * Their form modes must already exist, as `installConfig(['bb_core'])`
   * leaves them.
   *
   * @param string ...$ids
   *   The display ids to create; all four when none are given.
   */
  protected function installShippedFormDisplays(string ...$ids): void {
    $ids = $ids ?: [
      'bb_project.bb_project.settings',
      'bb_group.bb_group.create',
      'bb_group.bb_group.settings',
      'bb_workspace.bb_workspace.settings',
    ];
    foreach ($ids as $id) {
      $this->installShippedConfigEntity('entity_form_display', 'core.entity_form_display.' . $id);
    }
  }

  /**
   * Creates the `avatar` image style and its crop type; needs `crop` enabled.
   */
  protected function installAvatarStyle(): void {
    $this->installShippedConfigEntity('crop_type', 'crop.type.bb_avatar');
    $this->installShippedConfigEntity('image_style', 'image.style.avatar');
  }

  /**
   * Creates one config entity from its recipe file unless it already exists.
   */
  private function installShippedConfigEntity(string $entity_type_id, string $name): void {
    // The repository root, seven levels above this file.
    $data = Yaml::parseFile(dirname(__DIR__, 7) . '/recipes/bakers/config/' . $name . '.yml');
    self::assertIsArray($data, "$name did not parse as a YAML mapping.");
    $storage = $this->container->get('entity_type.manager')->getStorage($entity_type_id);
    if ($storage->load($data['id'] ?? $data['name']) === NULL) {
      $storage->create($data)->save();
    }
  }

}
