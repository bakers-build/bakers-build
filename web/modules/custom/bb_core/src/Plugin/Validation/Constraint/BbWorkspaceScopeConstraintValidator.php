<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\Plugin\Field\FieldType\EntityReferenceItem;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\BbActiveWorkspaceInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Two guards then two rules, in order, for every item of the field.
 *
 * On JSON:API the payload names its workspace and this is the one gate; rule 2
 * (ambient match) fires only on a browser add form. Rule 1 keys on WORKSPACE
 * membership only: a bare project membership grants reads, never writes. No
 * guard exempts agents.
 *
 * @see \Drupal\bb_core\Plugin\Validation\Constraint\BbWorkspaceScopeConstraint
 */
final class BbWorkspaceScopeConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs a BbWorkspaceScopeConstraintValidator.
   *
   * @param \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface $readScope
   *   The membership oracle and the bypass question.
   * @param \Drupal\bb_core\Access\BbActiveWorkspaceInterface $activeWorkspace
   *   The active-workspace resolver, consulted only for rule 2.
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   The acting account.
   * @param \Drupal\bb_core\Access\WorkspaceResolverInterface $workspaceResolver
   *   Walks a non-workspace referenced value to the workspace above it.
   */
  public function __construct(
    private readonly BbWorkspaceReadScopeInterface $readScope,
    private readonly BbActiveWorkspaceInterface $activeWorkspace,
    private readonly AccountInterface $currentUser,
    private readonly WorkspaceResolverInterface $workspaceResolver,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_core.workspace_read_scope'),
      $container->get('bb_core.active_workspace'),
      $container->get('current_user'),
      $container->get('bb_core.workspace_resolver'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof BbWorkspaceScopeConstraint);
    // The base-class signature is `mixed` and cannot be narrowed, so the type
    // is checked here rather than documented as a promise the signature does
    // not keep. Anything that is not a field item list is not this
    // constraint's business.
    if (!$items instanceof FieldItemListInterface) {
      return;
    }
    $account = $this->currentUser;
    // Guard B: the global escape hatch, asked as a permission — never read off
    // the shape of a condition group.
    if ($this->readScope->isBypassed($account, $items->getEntity()->getEntityTypeId())) {
      return;
    }
    $owned = $this->readScope->workspaceIds($account);
    $field = $items->getFieldDefinition()->getLabel();
    // EVERY item, not just the first. None of the four constrained fields is
    // multi-value today, but a `first()`-only validator is one cardinality
    // change away from waving a foreign value through at delta 1 — and it would
    // do so silently, which is the failure mode this whole feature exists to
    // avoid. The first offending item raises the violation and ends the walk:
    // one message per field is what a form and a JSON:API error document can
    // both render usefully.
    foreach ($items as $item) {
      // Guard A: emptiness is NotNull's business. A second message about the
      // same emptiness would be noise. The item type is checked rather than
      // assumed: all four constrained fields are entity references today, and
      // `->entity` exists on no other item type.
      if (!$item instanceof EntityReferenceItem) {
        continue;
      }
      $referenced = $item->entity;
      if (!$referenced instanceof EntityInterface) {
        continue;
      }
      $workspace = $this->workspaceOf($referenced);
      if ($workspace === NULL) {
        // A value whose workspace cannot be resolved is not assignable: a group
        // without a workspace would otherwise slip a project into no workspace.
        $this->context->addViolation($constraint->orphanMessage, [
          '%field' => $field,
        ]);
        return;
      }
      // Rule 1: membership.
      if (!in_array((int) $workspace->id(), $owned, TRUE)) {
        $this->context->addViolation($constraint->membershipMessage, [
          '%workspace' => $workspace->label(),
        ]);
        return;
      }
      // Rule 2: the ambient match, under an add-form route only.
      if ($this->violatesAmbientMatch($constraint, $field, $workspace)) {
        return;
      }
    }
  }

  /**
   * Resolves the workspace a referenced value belongs to.
   *
   * `bb_group.workspace_id` and `bb_team.workspace_id` reference a
   * `bb_workspace` directly, so the referenced value itself is already the
   * workspace in that case. `WorkspaceResolverInterface::CHAINS` deliberately
   * has no `bb_workspace` entry (its own routes stay at `/admin/bakers`), so a
   * bare `resolve()` call would answer NULL for exactly those two fields and
   * reject every legitimate group/team write. The identity case has to be
   * checked here, before delegating anything else to the resolver.
   *
   * @param \Drupal\Core\Entity\EntityInterface $referenced
   *   The referenced entity.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface|null
   *   The workspace, or NULL when it cannot be resolved.
   */
  private function workspaceOf(EntityInterface $referenced): ?BbWorkspaceInterface {
    if ($referenced instanceof BbWorkspaceInterface) {
      return $referenced;
    }
    return $this->workspaceResolver->resolve($referenced);
  }

  /**
   * Rule 2: under an add-form route the value must match what we create in.
   *
   * Gated on the ROUTE source, which since the correction means exactly one
   * thing: an add-form URL named a workspace. Off such a route — every
   * JSON:API write, every edit form — there is no ambient workspace to compare
   * against and rule 1 is the whole gate.
   *
   * @param \Drupal\bb_core\Plugin\Validation\Constraint\BbWorkspaceScopeConstraint $constraint
   *   The constraint carrying the message.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|string $field
   *   The label of the field being validated, for the message.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace behind the referenced value.
   *
   * @return bool
   *   TRUE when a violation was raised.
   */
  private function violatesAmbientMatch(BbWorkspaceScopeConstraint $constraint, TranslatableMarkup|string $field, BbWorkspaceInterface $workspace): bool {
    if ($this->activeWorkspace->source() !== BbActiveWorkspaceInterface::SOURCE_ROUTE) {
      return FALSE;
    }
    $active = $this->activeWorkspace->resolve();
    if ($active === NULL || (int) $active->id() === (int) $workspace->id()) {
      return FALSE;
    }
    $this->context->addViolation($constraint->ambientMessage, [
      '%field' => $field,
      '%workspace' => $workspace->label(),
      '%active' => $active->label(),
    ]);
    return TRUE;
  }

}
