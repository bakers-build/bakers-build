<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\Component\Uuid\Uuid;

/**
 * Resolves project and UUID inputs under view access, and a project's output.
 *
 * Users of this trait also use TicketInputTrait for entities().
 */
trait ProjectInputTrait {

  /**
   * The readable project of this key or UUID, or an input error.
   *
   * @throws \InvalidArgumentException
   */
  protected function readableProject(string $project): BbProjectInterface {
    $field = Uuid::isValid($project) ? 'uuid' : 'key';
    $storage = $this->entities()->getStorage('bb_project');
    $ids = $storage->getQuery()->accessCheck(TRUE)->condition($field, $project)->range(0, 1)->execute();
    $entity = $ids ? $storage->load(reset($ids)) : NULL;
    if (!$entity instanceof BbProjectInterface || !$entity->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('Project %s does not exist or is not readable.', $project));
    }
    return $entity;
  }

  /**
   * The id of the readable entity of this type and UUID, or an input error.
   *
   * @throws \InvalidArgumentException
   */
  protected function readableId(string $type, string $uuid, string $thing): int|string {
    $ids = $this->entities()->getStorage($type)->getQuery()->accessCheck(TRUE)
      ->condition('uuid', $uuid)->range(0, 1)->execute();
    if (!$ids) {
      throw new \InvalidArgumentException(sprintf('%s %s does not exist or is not readable.', $thing, $uuid));
    }
    return reset($ids);
  }

  /**
   * The project_read output: never env_vars, view-gated repository/config.
   *
   * @return array<string, mixed>
   *   Output values keyed by name.
   */
  protected function projectOutput(BbProjectInterface $project): array {
    $viewable = fn (string $field): bool => !$project->get($field)->isEmpty()
      && $project->get($field)->access('view', $this->currentUser);
    $repository = $project->get('repository')->first()?->getValue();
    return [
      'uuid' => $project->uuid(),
      'key' => $project->getKey(),
      'name' => $project->label(),
      'description' => $project->get('description')->value,
      'group' => $project->getGroup()?->uuid(),
      'teams' => array_map(static fn ($team) => $team->uuid(), $project->getTeams()),
      'repository' => $viewable('repository') ? [
        'url' => $repository['url'],
        'default_branch' => $repository['default_branch'] ?? NULL,
        'branch_convention' => $repository['branch_convention'] ?? NULL,
      ] : NULL,
      'coder_config' => $viewable('coder_config') ? $project->get('coder_config')->first()?->getValue() : NULL,
    ];
  }

}
