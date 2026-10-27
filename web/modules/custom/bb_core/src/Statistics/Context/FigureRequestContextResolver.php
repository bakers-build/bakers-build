<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Context;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Resolves the public named statistics context query parameters.
 */
final class FigureRequestContextResolver {

  private const PARAMETERS = [
    'workspace_id' => ['workspace', 'bb_workspace'],
    'project_id' => ['project', 'bb_project'],
    'team_id' => ['team', 'bb_team'],
    'user_id' => ['user', 'user'],
  ];

  /**
   * The filter keys that select a list of entities.
   */
  private const ENTITY_FILTERS = ['epic', 'project', 'team', 'user'];

  public function __construct(
    private readonly EntityRepositoryInterface $entityRepository,
  ) {}

  /**
   * Resolves all named entity contexts present in the request.
   *
   * @return array<string, EntityInterface>
   *   Context entities keyed by their public context name.
   */
  public function fromRequest(Request $request): array {
    if ($request->query->has('scope_id')) {
      throw new BadRequestHttpException('scope_id is no longer supported; use a named context parameter.');
    }
    $contexts = [];
    foreach (self::PARAMETERS as $parameter => [$key, $entityType]) {
      $uuid = trim((string) $request->query->get($parameter, ''));
      if ($uuid === '') {
        continue;
      }
      $entity = $this->entityRepository->loadEntityByUuid($entityType, $uuid);
      if (!$entity instanceof EntityInterface) {
        throw new NotFoundHttpException(sprintf('No %s context with uuid %s.', $key, $uuid));
      }
      $contexts[$key] = $entity;
    }
    if ($contexts === []) {
      throw new BadRequestHttpException('At least one named statistics context is required.');
    }
    return $contexts;
  }

  /**
   * Reads selected figure filters from the request.
   *
   * Only the entity filters take a list (`filter[project][]=<uuid>`); every
   * other filter has exactly one value.
   *
   * @return array<string, string|list<string>>
   *   Selected values keyed by filter name.
   */
  public function filtersFromRequest(Request $request): array {
    $filters = $request->query->all('filter');
    $selected = [];
    foreach ($filters as $key => $value) {
      if (is_array($value) && in_array($key, self::ENTITY_FILTERS, TRUE) && array_is_list($value)
        && array_filter($value, static fn(mixed $item): bool => !is_scalar($item)) === []) {
        $selected[(string) $key] = array_map('strval', $value);
        continue;
      }
      if (!is_scalar($value)) {
        throw new BadRequestHttpException(sprintf('Filter %s must have one value.', $key));
      }
      $selected[(string) $key] = (string) $value;
    }
    return $selected;
  }

}
