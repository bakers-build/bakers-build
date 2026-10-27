<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;

/**
 * Answers whether a conductor's owner may currently work in a project.
 *
 * Work goes to a conductor only while its owner sees the project (a team of
 * it, or workspace Admin) and holds a working rank (Contributor or Admin) in
 * its workspace. Nothing is memoised here: the read scope is reset on every
 * membership write, so a lost or regained membership counts at once.
 */
final class ConductorOwnerAccess {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbWorkspaceReadScopeInterface $readScope,
    private readonly BbRankCapabilityInterface $rankCapability,
    private readonly WorkspaceResolverInterface $workspaceResolver,
  ) {
  }

  /**
   * Whether the conductor's owner has access to the given project.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor whose owner is asked about.
   * @param int $project_id
   *   The project the work belongs to.
   *
   * @return bool
   *   TRUE when the owner may work in the project.
   */
  public function ownerHasAccess(BbConductorInterface $conductor, int $project_id): bool {
    $owner = $conductor->get('owner_user_id')->entity;
    if (!$owner instanceof UserInterface || $owner->isAnonymous()) {
      return FALSE;
    }
    if ($this->rankCapability->isInstanceAdmin($owner)) {
      return TRUE;
    }
    if (!in_array($project_id, $this->readScope->projectIds($owner), TRUE)) {
      return FALSE;
    }
    $project = $this->entityTypeManager->getStorage('bb_project')->load($project_id);
    $workspace = $project instanceof BbProjectInterface ? $this->workspaceResolver->resolve($project) : NULL;
    return $workspace !== NULL && $this->rankCapability->hasGroupPermission($owner, 'claim bakers tickets', $workspace);
  }

  /**
   * Whether the owner is the ticket's assignee or a reviewer.
   *
   * A ticket without an assignee takes any conductor with access; saving then
   * derives the assignee from the conductor's owner.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor whose owner is asked about.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket, with the values being saved.
   *
   * @return bool
   *   TRUE when the owner is responsible for the ticket, or none is set.
   */
  public function ownerIsResponsible(BbConductorInterface $conductor, BbTicketInterface $ticket): bool {
    $assignee = $ticket->get('assignee_user_id')->target_id;
    if ($assignee === NULL || $assignee === '') {
      return TRUE;
    }
    $responsible = array_map('strval', array_column($ticket->get('reviewers')->getValue(), 'target_id'));
    $responsible[] = (string) $assignee;
    return in_array((string) $conductor->get('owner_user_id')->target_id, $responsible, TRUE);
  }

}
