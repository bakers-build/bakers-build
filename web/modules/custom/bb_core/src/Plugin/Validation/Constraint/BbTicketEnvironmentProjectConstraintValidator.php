<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\Plugin\Field\FieldType\EntityReferenceItem;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Rejects an environment whose project is not the ticket's own.
 *
 * NO BYPASS GUARD, matching BbTicketLabelWorkspaceConstraintValidator's
 * rationale: a ticket of project A holding project B's environment is wrong
 * on an administrator's form too, because this is a data-integrity question
 * rather than an access one.
 *
 * bb_environment carries project_id directly (it has no workspace_id), so
 * this is a one-hop comparison against the ticket's own project_id — never
 * routed through WorkspaceResolverInterface, which would weaken the rule to
 * workspace level and still admit a sibling project's environment.
 */
final class BbTicketEnvironmentProjectConstraintValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof BbTicketEnvironmentProjectConstraint);
    if (!$items instanceof FieldItemListInterface) {
      return;
    }
    $ticket = $items->getEntity();
    if (!$ticket instanceof BbTicketInterface) {
      return;
    }
    // Emptiness first, same cost argument as BbTicketLabelWorkspace: this
    // sits on a base field and runs on every bb_ticket->validate(),
    // including the many that carry no environment at all.
    if ($items->isEmpty()) {
      return;
    }
    // A ticket with no resolvable project has no project yet, and that
    // emptiness is project_id's own business. Two messages about one missing
    // value is noise.
    $ticket_project = $ticket->get('project_id')->entity;
    if (!$ticket_project instanceof BbProjectInterface) {
      return;
    }

    // EVERY item — environments is genuinely multi-value, so a first()-only
    // walk would wave a foreign environment through at delta 1. The first
    // offender raises the violation and ends the walk.
    foreach ($items as $item) {
      $parameters = $this->foreignEnvironmentParameters($item, $ticket_project);
      if ($parameters === NULL) {
        continue;
      }
      $this->context->addViolation($constraint->message, $parameters);
      return;
    }
  }

  /**
   * The message placeholders for one offending item, or NULL if it is in scope.
   *
   * @param mixed $item
   *   One item of the environments field.
   * @param \Drupal\bb_core\Entity\BbProjectInterface $ticket_project
   *   The ticket's own project.
   *
   * @return array<string, mixed>|null
   *   The placeholders for the violation, or NULL when this item raises none.
   */
  private function foreignEnvironmentParameters(mixed $item, BbProjectInterface $ticket_project): ?array {
    if (!$item instanceof EntityReferenceItem) {
      return NULL;
    }
    $environment = $item->entity;
    if (!$environment instanceof BbEnvironmentInterface) {
      return NULL;
    }
    $environment_project = $environment->get('project_id')->entity;
    if (!$environment_project instanceof BbProjectInterface) {
      return NULL;
    }
    if ((int) $environment_project->id() === (int) $ticket_project->id()) {
      return NULL;
    }

    return [
      '%environment' => $environment->label(),
      '%environment_project' => $environment_project->label(),
      '%ticket_project' => $ticket_project->label(),
    ];
  }

}
