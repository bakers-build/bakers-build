<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\Plugin\Field\FieldType\EntityReferenceItem;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Rejects a label term whose workspace is not the ticket's own.
 *
 * NO BYPASS GUARD, and that is the one structural difference from
 * BbWorkspaceScopeConstraintValidator. That constraint answers "may this
 * account write this edge" — an access question, where `administer bakers` is a
 * legitimate escape hatch. This one answers "is this row internally
 * consistent" — a data-integrity question. A ticket of workspace A labelled by
 * a term of workspace B is wrong on an administrator's form too.
 *
 * The ticket's workspace comes from WorkspaceResolverInterface, whose
 * CHAINS['bb_ticket'] is already project_id → group_id → workspace_id. The
 * chain is CONSUMED, never restated: a copy here would diverge silently the
 * first time the anchor moves.
 */
final class BbTicketLabelWorkspaceConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs the validator.
   *
   * @param \Drupal\bb_core\Access\WorkspaceResolverInterface $workspaceResolver
   *   Walks the ticket to the workspace above it.
   */
  public function __construct(
    private readonly WorkspaceResolverInterface $workspaceResolver,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('bb_core.workspace_resolver'));
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof BbTicketLabelWorkspaceConstraint);
    if (!$items instanceof FieldItemListInterface) {
      return;
    }
    $ticket = $items->getEntity();
    if (!$ticket instanceof BbTicketInterface && !$ticket instanceof BbTicketTemplateInterface) {
      return;
    }
    // Emptiness FIRST, and the order is load-bearing rather than tidy. The
    // resolve() below walks project_id → group_id → workspace_id, so it can
    // load three entities; this constraint sits on a base field, so it runs on
    // every bb_ticket->validate() including the many that carry no label at
    // all. Gating the walk on the cheap check keeps the labelless case free.
    // Answering after the walk would be identical — the loop below has nothing
    // to iterate — so this is a cost fix, not a behaviour change.
    if ($items->isEmpty()) {
      return;
    }
    // A ticket with no resolvable workspace has no project yet, and that
    // emptiness is project_id's own business. Two messages about one missing
    // value is noise.
    $ticket_workspace = $this->workspaceResolver->resolve($ticket);
    if ($ticket_workspace === NULL) {
      return;
    }

    // EVERY item. Unlike the four single-value fields BbWorkspaceScope
    // guards, labels is genuinely multi-value, so a first()-only walk would
    // wave a foreign term through at delta 1. The first offender raises the
    // violation and ends the walk: one message per field is what a form and a
    // JSON:API error document can both render usefully.
    foreach ($items as $item) {
      $parameters = $this->foreignLabelParameters($item, $ticket_workspace);
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
   * One item, one question: is THIS delta a term of a workspace other than the
   * ticket's? Everything that is not that answers NULL — an item of another
   * type, a reference that resolves to no term, and a term whose own workspace
   * is empty, which is the term's required field talking and, between the
   * storage install and the backfill, is every term.
   *
   * Extracted rather than inlined because `NPathComplexity` is a PER-METHOD
   * metric that multiplies across branches: four sequential guards in the loop
   * body multiply the whole method's count, and moving them behind one call
   * genuinely lowers what is measured. That is the opposite of the argument
   * `phpmd.xml.dist` makes against extraction, and deliberately so — that
   * argument is about the class-level sum, where a new method starts at 1 and
   * nothing is won.
   *
   * @param mixed $item
   *   One item of the labels field.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $ticket_workspace
   *   The workspace the ticket resolves to.
   *
   * @return array<string, mixed>|null
   *   The placeholders for the violation, or NULL when this item raises none.
   */
  private function foreignLabelParameters(mixed $item, BbWorkspaceInterface $ticket_workspace): ?array {
    if (!$item instanceof EntityReferenceItem) {
      return NULL;
    }
    $term = $item->entity;
    if (!$term instanceof BbTermInterface) {
      return NULL;
    }
    $term_workspace = $term->get('workspace_id')->entity;
    if ($term_workspace === NULL) {
      return NULL;
    }
    if ((int) $term_workspace->id() === (int) $ticket_workspace->id()) {
      return NULL;
    }

    return [
      '%label' => $term->label(),
      '%label_workspace' => $term_workspace->label(),
      '%ticket_workspace' => $ticket_workspace->label(),
    ];
  }

}
