<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityChangedTrait;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\WorkspaceResolverInterface;

/**
 * Provides the common base for all bakers.build content entities.
 *
 * Adds the standard 'created' and 'changed' timestamp fields and exposes them
 * through the BbContentEntityInterface accessors so that every concrete
 * bakers.build entity inherits uniform creation/modification tracking without
 * repetition.
 */
abstract class BbContentEntityBase extends ContentEntityBase implements BbContentEntityInterface {

  use EntityChangedTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(new TranslatableMarkup('Created'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', [
        'type' => 'datetime_timestamp',
        'weight' => 90,
      ]);

    $fields['changed'] = BaseFieldDefinition::create('changed')
      ->setLabel(new TranslatableMarkup('Changed'));

    return $fields;
  }

  /**
   * {@inheritdoc}
   *
   * Fills the workspace segment of a product URL.
   *
   * The one place a workspace-prefixed URL is composed; every bakers.build link
   * goes through toUrl(). Keyed on the link template, not the rel: only
   * templates containing `{bb_workspace}` get the parameter, otherwise Url
   * would turn it into a query argument. The same pass swaps a type's own slot
   * for its human reference, declared once in HUMAN_REFERENCE_FIELDS.
   */
  protected function urlRouteParameters($rel) {
    $parameters = parent::urlRouteParameters($rel);
    $template = $this->getEntityType()->getLinkTemplate($rel);
    if (!is_string($template) || !str_contains($template, '{bb_workspace}')) {
      return $parameters;
    }
    $workspace = $this instanceof BbWorkspaceInterface ? $this : \Drupal::service(WorkspaceResolverInterface::class)->resolve($this);
    if ($workspace instanceof BbWorkspaceInterface && $workspace->getSlug() !== '') {
      $parameters['bb_workspace'] = $workspace->getSlug();
    }
    return $this->applyHumanReference($parameters);
  }

  /**
   * The field whose value addresses a type in a URL instead of its row id.
   *
   * Both fields already carry an instance-wide UniqueField, so no new
   * uniqueness mechanism appears with them. The six workspace-owned types
   * absent from this map have no human reference and keep the numeric id.
   */
  private const HUMAN_REFERENCE_FIELDS = [
    'bb_ticket' => 'identifier',
    'bb_project' => 'key',
  ];

  /**
   * Swaps this entity's own route slot for its lowercased human reference.
   *
   * @param array $parameters
   *   The route parameters composed so far.
   *
   * @return array
   *   The parameters, with the entity's own slot replaced when it has a
   *   human reference. A row without one — a ticket saved with no project —
   *   keeps its id, which the same converter still resolves.
   */
  private function applyHumanReference(array $parameters): array {
    $slot = $this->getEntityTypeId();
    $field = self::HUMAN_REFERENCE_FIELDS[$slot] ?? NULL;
    if ($field === NULL || !isset($parameters[$slot])) {
      return $parameters;
    }
    $reference = (string) ($this->get($field)->value ?? '');
    if ($reference !== '') {
      $parameters[$slot] = mb_strtolower($reference);
    }
    return $parameters;
  }

  /**
   * {@inheritdoc}
   */
  public function getCreatedTime(): int {
    return (int) $this->get('created')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setCreatedTime(int $timestamp): static {
    $this->set('created', $timestamp);
    return $this;
  }

}
