<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;

/**
 * A second workspace whose contributor must never see the first one's rows.
 */
trait ForeignWorkspaceTrait {

  /**
   * Creates a workspace owned by a new contributor and acts as that account.
   *
   * @return array{0: \Drupal\Core\Entity\ContentEntityInterface, 1: \Drupal\user\UserInterface}
   *   The foreign workspace and its contributor, now the current user.
   */
  protected function foreignWorkspace(): array {
    $stranger = $this->account('stranger', ['skill_user']);
    // Owned by the stranger, so the base actor gets no owner membership.
    $workspace = $this->entity('bb_workspace', [
      'name' => 'foreign',
      'slug' => 'foreign',
      'owner_user_id' => $stranger->id(),
    ]);
    $this->addMembership($workspace, $stranger, ['contributor']);
    $this->container->get('current_user')->setAccount($stranger);
    return [$workspace, $stranger];
  }

  /**
   * Creates an entity of the given type with the given values.
   *
   * @param string $type
   *   The entity type id.
   * @param array<string, mixed> $values
   *   Field values.
   */
  protected function entity(string $type, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage($type)->create($values);
    assert($entity instanceof ContentEntityInterface);
    $entity->save();
    return $entity;
  }

}
