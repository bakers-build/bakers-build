<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates that a term name is unique within its workspace and vocabulary.
 *
 * Applied to bb_term.name. The key is (workspace_id, vid, name)
 * and not (workspace_id, name), because `codex` exists on the live instance as
 * both a label term and a term of another bundle: the narrower key
 * would have failed on real data and forced a merge of two terms that mean
 * different things.
 */
#[Constraint(
  id: 'BbTermUniqueNameInWorkspace',
  label: new TranslatableMarkup('bakers.build term name unique per workspace and vocabulary'),
)]
final class BbTermUniqueNameInWorkspaceConstraint extends SymfonyConstraint {

  /**
   * Violation message when the name is already used in the same scope.
   *
   * It names the NAME and nothing else. The lookup runs with
   * accessCheck(FALSE), so it can find a row in a workspace the writer cannot
   * see, and a message carrying that row's details would disclose it.
   *
   * @var string
   */
  public string $message = 'A term named %name already exists in this workspace and vocabulary.';

  /**
   * Violation message when a new label's name maps to a taken label key.
   *
   * Names the existing label in the writer's own workspace, so it can be used.
   *
   * @var string
   */
  public string $keyMessage = 'The label %label already stands for %name; use it instead.';

}
