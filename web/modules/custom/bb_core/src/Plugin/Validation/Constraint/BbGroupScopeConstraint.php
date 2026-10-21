<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A reference may not anchor a row in a tenancy the actor has no rank in.
 *
 * The create-side half of the rank fence. The fence answers
 * hook_entity_access(), which core does not call for a create:
 * `checkCreateAccess()` receives a bundle and a context but no entity, so there
 * is no group to resolve and nothing to fence against. A row's tenancy is
 * decided by the reference it is created WITH, so the fence for that case has
 * to sit on the reference.
 *
 * It also covers the one case no access check reaches at all: RE-POINTING a
 * saved row. `update` is decided against the entity as stored, so an actor
 * entitled to edit its own workspace's ticket passes that check and could then
 * move the ticket somewhere it holds nothing.
 */
#[Constraint(
  id: 'BbGroupScope',
  label: new TranslatableMarkup('bakers.build group scope', [], ['context' => 'Validation']),
)]
final class BbGroupScopeConstraint extends SymfonyConstraint {

  /**
   * The reference field that anchors each scoped type in its tenancy.
   *
   * Owned by the constraint because it is the constraint's own attachment map,
   * read by bb_core_entity_base_field_info_alter(). It is deliberately NOT a
   * second copy of the chain BbRankEntityFence walks: this names only WHICH
   * field decides a row's tenancy, while resolving where that leads stays the
   * fence's job.
   *
   * bb_run and bb_conductor are absent on purpose: both are written by the
   * machine that owns them on the hottest write path and never re-pointed by a
   * human, so the constraint would buy nothing and cost a pass per claim.
   *
   * @var array<string, string>
   */
  public const ANCHORS = [
    'bb_ticket' => 'project_id',
    'bb_ticket_template' => 'project_id',
    'bb_ticket_trigger' => 'workspace_id',
    'bb_comment' => 'ticket_id',
    'bb_environment' => 'project_id',
    // The actor must hold `create bb_project` in a team the project is
    // placed into; anchoring on the workspace would re-attach the right to it.
    // `group_id` keeps its own BbWorkspaceScope constraint.
    'bb_project' => 'teams',
    'bb_group' => 'workspace_id',
    'bb_team' => 'workspace_id',
  ];

  /**
   * A second anchor field, for a type anchored on one of two fields.
   *
   * A ticket template belongs to exactly one project or one workspace.
   *
   * @var array<string, string>
   */
  public const ALTERNATE_ANCHORS = [
    'bb_ticket_template' => 'workspace_id',
  ];

  /**
   * The violation message.
   *
   * Deliberately says nothing about the target row beyond the value the caller
   * already sent: the whole point of tenancy is that the existence of a row in
   * another workspace is not disclosed (the same reason a workspace mismatch
   * answers 404 rather than 403).
   *
   * @var string
   */
  public string $message = 'You may not place this in that tenancy.';

}
