<?php

declare(strict_types=1);

namespace Drupal\bb_core\Project;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Inspector\InspectorRows;

/**
 * Formats read-only project properties for the Overview inspector list.
 */
final class ProjectInspectorRows extends InspectorRows {

  /**
   * Inspector fields in display order, keyed by field name.
   */
  public const array FIELDS = [
    'key' => 'Key',
    'repository' => 'Repository',
    'environments' => 'Environments',
  ];

  /**
   * Overview omits empty properties; ticket detail keeps dashes.
   */
  protected bool $omitEmpty = TRUE;

  /**
   * Builds the rail's `items` array, keyed by field, omitting empty rows.
   *
   * @return array<string, array<string, mixed>>
   *   List items keyed by field machine name.
   */
  public function build(BbProjectInterface $project): array {
    return $this->buildRows($project, self::FIELDS);
  }

  /**
   * {@inheritdoc}
   */
  protected function fieldRow(FieldableEntityInterface $entity, string $field, string $label): array {
    assert($entity instanceof BbProjectInterface);
    return match ($field) {
      'key' => $this->row($label, $this->mono(trim((string) $entity->get('key')->value))),
      'repository' => $this->row($label, $this->mono($this->repositoryLabel($entity))),
      'environments' => $this->environmentRow($entity),
      default => $this->row($label, $this->dash()),
    };
  }

  /**
   * Repository URL, with default branch when set.
   */
  private function repositoryLabel(BbProjectInterface $project): string {
    $value = $project->get('repository')->first()?->getValue() ?? [];
    $url = trim((string) ($value['url'] ?? ''));
    if ($url === '') {
      return '';
    }
    $branch = trim((string) ($value['default_branch'] ?? ''));
    return $branch === '' ? $url : $url . ' (' . $branch . ')';
  }

  /**
   * Environments as inspector badges, one cell per name.
   *
   * @return array<string, mixed>
   *   A `list` item; empty names become the faint dash so omitEmpty drops it.
   */
  private function environmentRow(BbProjectInterface $project): array {
    $chips = [];
    foreach ($project->get('environments')->referencedEntities() as $environment) {
      $name = trim((string) $environment->label());
      if ($name !== '') {
        $chips[] = $this->badge($name);
      }
    }
    return $this->chipsRow('Environments', $chips);
  }

}
