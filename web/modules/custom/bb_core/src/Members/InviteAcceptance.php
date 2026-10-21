<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\StringTranslation\TranslationInterface;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\Validation\Constraint\BbInviteAssignmentConstraintValidator;
use Drupal\bb_core\Workspace\WorkspaceProvisioner;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;
use Drupal\user\UserInterface;

/**
 * Redeems an invitation: the workspace role, the team, then the deletion.
 *
 * An invitation is a standing grant authorised when it was created, so who
 * accepts it is the join form's question (address and expiry), not this
 * class's. What is re-checked here is whether the grant still makes sense.
 */
final class InviteAcceptance {

  use StringTranslationTrait;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly Connection $database,
    private readonly WorkspaceProvisioner $provisioner,
    TranslationInterface $stringTranslation,
  ) {
    $this->setStringTranslation($stringTranslation);
  }

  /**
   * Applies the invitation for this account, all or nothing.
   *
   * @param \Drupal\bb_core\Entity\BbInvite $invite
   *   The persisted invitation, already matched to the account.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   Its workspace.
   * @param \Drupal\user\UserInterface $account
   *   The accepting account.
   *
   * @return \Drupal\Core\StringTranslation\TranslatableMarkup|null
   *   Why the invitation cannot be accepted, keeping it; NULL once applied.
   */
  public function accept(BbInvite $invite, BbWorkspaceInterface $workspace, UserInterface $account): ?TranslatableMarkup {
    $role = $this->entityTypeManager->getStorage('og_role')->load($invite->getRoleId());
    // Fails closed: an explicit rank that is gone is never swapped for another.
    if (!$role instanceof OgRoleInterface || !BbInviteAssignmentConstraintValidator::roleIsAssignable($invite, $workspace)) {
      return $this->t('This invitation grants a workspace role that no longer exists. Ask a workspace admin for a new invitation.');
    }
    $team = $this->team($invite, $workspace);
    $workspace_membership = Og::getMembership($workspace, $account, OgMembershipInterface::ALL_STATES);
    $team_membership = $team !== NULL ? Og::getMembership($team, $account, OgMembershipInterface::ALL_STATES) : NULL;
    // A pending or blocked membership is a lead's decision, not the link's.
    if (self::isInactive($workspace_membership) || self::isInactive($team_membership)) {
      return $this->t('Your membership is not active. Ask a workspace admin to restore it.');
    }
    $this->apply($invite, $account, [
      [$workspace, $workspace_membership, (string) $role->id()],
      [$team, $team_membership, WorkspaceProvisioner::TEAM_MEMBER_ROLE],
    ]);
    return NULL;
  }

  /**
   * The invited team, unless it was deleted or moved to another workspace.
   */
  private function team(BbInvite $invite, BbWorkspaceInterface $workspace): ?BbTeamInterface {
    if (!BbInviteAssignmentConstraintValidator::teamIsAssignable($invite, $workspace)) {
      return NULL;
    }
    $team = $invite->get('team_id')->entity;
    return $team instanceof BbTeamInterface ? $team : NULL;
  }

  /**
   * Whether a membership exists but is pending or blocked.
   */
  private static function isInactive(?OgMembershipInterface $membership): bool {
    return $membership !== NULL && !$membership->isActive();
  }

  /**
   * Writes missing memberships and deletes the invitation, atomically.
   *
   * An existing active membership keeps its rank: the invitation only adds.
   *
   * @param \Drupal\bb_core\Entity\BbInvite $invite
   *   The invitation to consume.
   * @param \Drupal\user\UserInterface $account
   *   The accepting account.
   * @param array<int, array{0: \Drupal\Core\Entity\ContentEntityInterface|null, 1: \Drupal\og\OgMembershipInterface|null, 2: string}> $grants
   *   Group, existing membership and role id, per group.
   */
  private function apply(BbInvite $invite, UserInterface $account, array $grants): void {
    $transaction = $this->database->startTransaction();
    try {
      foreach ($grants as [$group, $existing, $role_id]) {
        if ($group !== NULL && $existing === NULL) {
          $this->provisioner->addMembership($account, $group, $role_id);
        }
      }
      $invite->delete();
    }
    catch (\Throwable $e) {
      $transaction->rollBack();
      throw $e;
    }
  }

}
