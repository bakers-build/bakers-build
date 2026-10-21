<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\og\OgRoleInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Rejects an invitation granting what its author may not grant.
 *
 * Three rules: the acting account holds `update` on the invitation's workspace
 * (the Members surface's own gate), the role is one that workspace offers,
 * and the team belongs to that workspace. Leading two workspaces does not make
 * a team of one assignable on an invitation to the other.
 */
final class BbInviteAssignmentConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  public function __construct(
    private readonly AccountInterface $currentUser,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('current_user'));
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    assert($constraint instanceof BbInviteAssignmentConstraint);
    $invite = $value;
    if (!$invite instanceof BbInvite) {
      return;
    }
    // A missing workspace is workspace_id's own violation.
    $workspace = $invite->getWorkspace();
    if ($workspace === NULL) {
      return;
    }
    if (!$workspace->access('update', $this->currentUser)) {
      $this->context->buildViolation($constraint->accessMessage, ['%workspace' => $workspace->label()])
        ->atPath('workspace_role')
        ->addViolation();
      return;
    }
    if (!self::roleIsAssignable($invite, $workspace)) {
      $this->context->buildViolation($constraint->roleMessage)
        ->atPath('workspace_role')
        ->addViolation();
    }
    if (!self::teamIsAssignable($invite, $workspace)) {
      $this->context->buildViolation($constraint->teamMessage, ['%workspace' => $workspace->label()])
        ->atPath('team_id')
        ->addViolation();
    }
  }

  /**
   * Whether the stored role is one the workspace offers; empty always is.
   *
   * Shared with acceptance, which re-checks a standing grant without asking
   * who accepts it.
   */
  public static function roleIsAssignable(BbInvite $invite, BbWorkspaceInterface $workspace): bool {
    // The member role is every membership's floor, offered or not.
    $member = $workspace->getEntityTypeId() . '-' . $workspace->bundle() . '-' . OgRoleInterface::AUTHENTICATED;
    if ($invite->get('workspace_role')->isEmpty() || $invite->getRoleId() === $member) {
      return TRUE;
    }
    $ids = array_map(
      static fn ($role): string => (string) $role->id(),
      MemberItemBuilder::assignableRoles($workspace),
    );
    return in_array($invite->getRoleId(), $ids, TRUE);
  }

  /**
   * Whether the stored team exists in the workspace; empty always is.
   */
  public static function teamIsAssignable(BbInvite $invite, BbWorkspaceInterface $workspace): bool {
    if ($invite->getTeamId() === NULL) {
      return TRUE;
    }
    $team = $invite->get('team_id')->entity;
    return $team instanceof BbTeamInterface
      && (string) $team->get('workspace_id')->target_id === (string) $workspace->id();
  }

}
