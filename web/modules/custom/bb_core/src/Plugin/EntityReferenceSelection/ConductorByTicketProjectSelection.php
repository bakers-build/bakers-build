<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\Plugin\EntityReferenceSelection\DefaultSelection;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;

/**
 * Scopes selectable conductors to the referring ticket's project.
 *
 * Ticket templates use it too: they carry the same `project_id` and
 * `conductor_id` fields. When the referring entity is a ticket with a
 * project, only conductors in
 * that project are referenceable. The `active` condition applies
 * unconditionally, with or without a ticket/project context; only the
 * *project* half falls open to the default query without one (e.g. a
 * programmatic call) — the BbConductorProjectMatch and BbConductorActive
 * constraints still guard the actual write.
 *
 * An inactive conductor is excluded unless it is the ticket's *current*
 * reference: `OptionsWidgetBase::getSelectedOptions()` drops a stored value
 * missing from the option list, so an unrelated form save would silently clear
 * a reference stranded on a deactivated conductor.
 */
#[EntityReferenceSelection(
  id: 'bb_conductor_by_ticket_project',
  label: new TranslatableMarkup("Conductors in the ticket's project"),
  entity_types: ['bb_conductor'],
  group: 'bb_conductor_by_ticket_project',
  weight: 0,
)]
class ConductorByTicketProjectSelection extends DefaultSelection {

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS'): QueryInterface {
    $query = parent::buildEntityQuery($match, $match_operator);
    $entity = $this->referringEntity();
    $currentTargetId = $entity !== NULL
      ? $entity->get('conductor_id')->target_id
      : NULL;

    $activeAndProject = $query->andConditionGroup()->condition('active', TRUE);
    if ($entity !== NULL) {
      $projectId = $entity->get('project_id')->target_id;
      $hasProject = $projectId !== NULL && $projectId !== '';
      // A ticket context with no resolvable project offers no candidates
      // (AC-3): unlike the no-entity-at-all case below, which is a
      // programmatic call this handler cannot scope at all, a ticket is
      // present here and simply has nothing to scope against yet. `0` is
      // never a valid entity id, so it is the sentinel that makes this
      // branch match nothing without a second, always-false query shape.
      $activeAndProject->condition('project_id', $hasProject ? $projectId : 0);
    }

    // The current-reference escape stands outside the project condition as
    // well as the active one: a stranded reference must survive a move of the
    // ticket to another project. Restricted to an already-saved ticket: a
    // new, unsaved ticket switching project context must never keep a
    // conductor selection from a previously opened project through this
    // escape (AC-3).
    $hasCurrent = $currentTargetId !== NULL && $currentTargetId !== ''
      && $entity !== NULL && !$entity->isNew();
    $condition = $hasCurrent
      ? $query->orConditionGroup()->condition($activeAndProject)->condition('id', $currentTargetId)
      : $activeAndProject;
    $query->condition($condition);
    return $query;
  }

  /**
   * The referring ticket or template, or NULL for any other context.
   */
  private function referringEntity(): BbTicketInterface|BbTicketTemplateInterface|null {
    $entity = $this->configuration['entity'] ?? NULL;
    return $entity instanceof BbTicketInterface || $entity instanceof BbTicketTemplateInterface ? $entity : NULL;
  }

}
