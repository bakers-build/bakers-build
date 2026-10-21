<?php

declare(strict_types=1);

namespace Drupal\bb_track\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_track\Access\SubmissionAccess;
use Drupal\bb_track\Access\WorklogQueryAccessHandler;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;

/**
 * An owner-private group of worklogs; `proposed` holds an unbooked proposal.
 */
#[ContentEntityType(
  id: 'bb_track_submission',
  label: new TranslatableMarkup('Submission'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => SubmissionAccess::class,
    'query_access' => WorklogQueryAccessHandler::class,
  ],
  base_table: 'bb_track_submission',
  constraints: ['SubmissionState' => []],
  links: ['canonical' => '/time/submission/{bb_track_submission}'],
)]
final class Submission extends ContentEntityBase implements EntityOwnerInterface {

  use EntityOwnerTrait;

  /**
   * {@inheritdoc}
   */
  protected function urlRouteParameters($rel) {
    $parameters = parent::urlRouteParameters($rel);
    if ($rel === 'canonical') {
      $parameters['bb_track_submission'] = $this->uuid();
    }
    return $parameters;
  }

  /**
   * Allowed state changes; proposal changes also need $serviceTransition.
   */
  public const TRANSITIONS = [
    'draft' => ['submitted'],
    'proposed' => ['draft', 'discarded'],
  ];

  /**
   * Set only by the week save and the proposal service.
   */
  public bool $serviceTransition = FALSE;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['owner_user_id'] = static::ownerBaseFieldDefinitions($entity_type)['owner_user_id']
      ->setRequired(TRUE)->setReadOnly(TRUE);
    $fields['state'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('State'))->setRequired(TRUE)
      ->setSetting('allowed_values', [
        'draft' => 'Draft',
        'submitted' => 'Submitted',
        'proposed' => 'Proposed',
        'discarded' => 'Discarded',
      ])
      ->setDefaultValue('draft');
    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    $original = $this->isNew() ? NULL : $storage->loadUnchanged($this->id());
    if (!$this->access($this->isNew() ? 'create' : 'update')
      || (int) $this->getOwnerId() !== (int) \Drupal::currentUser()->id()
      || ($original instanceof self && (int) $original->getOwnerId() !== (int) $this->getOwnerId())) {
      throw new \DomainException('Submissions belong to their authenticated creator.');
    }
    $state = $this->get('state')->value;
    if (!in_array($state, ['draft', 'submitted', 'proposed', 'discarded'], TRUE)) {
      throw new \InvalidArgumentException('Unknown submission state.');
    }
    if (!$this->stateChangeAllowed($original instanceof self ? $original : NULL)) {
      throw new \DomainException('This submission cannot change to ' . $state . '.');
    }
  }

  /**
   * Whether the current state is a valid start or change from the stored one.
   */
  public function stateChangeAllowed(?self $original = NULL): bool {
    if ($original === NULL && !$this->isNew()) {
      $original = \Drupal::entityTypeManager()->getStorage($this->getEntityTypeId())->loadUnchanged($this->id());
    }
    $state = $this->get('state')->value;
    $from = $original instanceof self ? $original->get('state')->value : NULL;
    if ($from === NULL) {
      return in_array($state, ['draft', 'proposed'], TRUE);
    }
    return $from === $state
      || (in_array($state, self::TRANSITIONS[$from] ?? [], TRUE) && ($from !== 'proposed' || $this->serviceTransition));
  }

  /**
   * {@inheritdoc}
   */
  public static function preDelete(EntityStorageInterface $storage, array $entities): void {
    throw new \DomainException('Submissions are retained.');
  }

}
