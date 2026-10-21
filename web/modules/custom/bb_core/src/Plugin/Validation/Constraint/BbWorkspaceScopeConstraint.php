<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Gates a workspace-anchoring reference on membership and on the ambient one.
 *
 * Applied to bb_group.workspace_id, bb_team.workspace_id,
 * bb_project.group_id and bb_ticket.project_id — one class for four fields
 * because all four need the same value-to-workspace walk and the same guards.
 *
 * This is THE gate, on every surface. The selection plugins narrow what a
 * widget offers (and, through core's ValidReference, what a submitted target
 * may be); the membership rule and the ambient-match rule live only here.
 */
#[Constraint(
  id: 'BbWorkspaceScope',
  label: new TranslatableMarkup('bakers.build workspace scope'),
)]
final class BbWorkspaceScopeConstraint extends SymfonyConstraint {

  /**
   * Violation message for a workspace the account is not a member of.
   *
   * @var string
   */
  public string $membershipMessage = 'Workspace %workspace is not one of yours; you cannot assign it.';

  /**
   * Violation message for a value that belongs to no workspace at all.
   *
   * Its own message rather than a reuse of membershipMessage with a dash where
   * the name goes: "Workspace — is not one of yours" reads as a membership
   * problem and sends the reader looking for a workspace that does not exist.
   * The value is orphaned; the reader has to be told that to fix it.
   *
   * @var string
   */
  public string $orphanMessage = 'The selected %field belongs to no workspace, so it cannot be assigned.';

  /**
   * Violation message for a value from another of the account's workspaces.
   *
   * @var string
   */
  public string $ambientMessage = 'The selected %field belongs to workspace %workspace, but you are creating in %active.';

}
