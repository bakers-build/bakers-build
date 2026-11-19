<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Component\Utility\Html;
use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\Plugin\EntityReferenceSelection\DefaultSelection;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Scopes selectable tickets to open tickets in the referring ticket's project.
 *
 * A saved referring ticket is never offered to itself.
 *
 * A search term matches the title or the identifier (`BB-283`, or the
 * number `283` alone), and every candidate reads `<identifier> · <title>`.
 *
 * Never a field handler: the create and property form displays select it
 * for their relation pickers through the `bb_picker` `selection_handler`
 * setting, and FormAlterHooks swaps it into the Settings form's
 * autocomplete. API and CLI keep the field's default handler; the
 * BbParentSameProject constraint guards their writes. The access-checked
 * query of DefaultSelection still applies.
 *
 * There is no current-reference escape: a relation a saved ticket already
 * holds is kept by the widget and the forms' rule, not offered here.
 */
#[EntityReferenceSelection(
  id: 'bb_ticket_in_ticket_project',
  label: new TranslatableMarkup("Tickets in the ticket's project"),
  entity_types: ['bb_ticket'],
  group: 'bb_ticket_in_ticket_project',
  weight: 0,
)]
class TicketInTicketProjectSelection extends DefaultSelection {

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS'): QueryInterface {
    $query = parent::buildEntityQuery(NULL, $match_operator);
    if ($match !== NULL && $match !== '') {
      $query->condition($query->orConditionGroup()
        ->condition('title', $match, $match_operator)
        ->condition('identifier', $match, $match_operator));
    }
    $entity = $this->configuration['entity'] ?? NULL;
    if ($entity instanceof BbTicketInterface) {
      $projectId = $entity->get('project_id')->target_id;
      // `0` is never a valid id: a ticket without a project offers nothing.
      $query->condition('project_id', $projectId !== NULL && $projectId !== '' ? $projectId : 0);
      if (!$entity->isNew()) {
        $query->condition('id', $entity->id(), '<>');
      }
    }
    $query->condition($query->orConditionGroup()
      ->condition('closed', TRUE, '<>')
      ->notExists('closed'));
    return $query;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, array<int|string, string>>
   *   Escaped `<identifier> · <title>` labels keyed by bundle, then id.
   */
  public function getReferenceableEntities($match = NULL, $match_operator = 'CONTAINS', $limit = 0): array {
    $options = parent::getReferenceableEntities($match, $match_operator, $limit);
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    foreach ($options as $bundle => $labels) {
      foreach ($storage->loadMultiple(array_keys($labels)) as $id => $ticket) {
        $identifier = $ticket instanceof BbTicketInterface ? $ticket->getIdentifier() : '';
        if ($identifier !== '') {
          $options[$bundle][$id] = Html::escape($identifier) . ' · ' . $labels[$id];
        }
      }
    }
    return $options;
  }

}
