<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Field\BaseBranchItemList;
use Drupal\bb_core\Field\CommentsItemList;
use Drupal\bb_core\Field\DeploymentsItemList;
use Drupal\bb_core\Field\HandoffCommentsItemList;
use Drupal\bb_core\Field\PendingReviewsItemList;
use Drupal\bb_core\Field\RunsItemList;
use Drupal\bb_core\Field\SubTicketsItemList;
use Drupal\bb_core\Field\SummaryCommentItemList;
use Drupal\bb_core\Field\TargetBranchItemList;
use Drupal\bb_core\Ticket\BranchName;

/**
 * Computed reverse refs, branch fields, and lifecycle/owner ticket fields.
 *
 * Split from BbTicket::baseFieldDefinitions() so that method stays under the
 * project phpmd length ceiling without growing the entity class complexity.
 *
 * @internal
 */
final class BbTicketFieldMap {

  use BbBaseFieldsTrait;

  /**
   * Builds the computed and lifecycle base field definitions.
   *
   * @return array<string, \Drupal\Core\Field\BaseFieldDefinition>
   *   Field definitions keyed by field name.
   */
  public static function computedAndLifecycle(): array {
    $fields = [];
    $fields['comments'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Comments'))
      ->setSetting('target_type', 'bb_comment')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setComputed(TRUE)
      ->setClass(CommentsItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    // `comments` split in two for the ticket_detail body: the
    // handoff stream is every comment that is NOT a summary, oldest first, and
    // the status band wants the newest summary alone. A field formatter renders
    // every referenced entity and has no predicate, so the filtering lives here
    // and the display stays pure config.
    $fields['handoff_comments'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Handoff comments'))
      ->setDescription(new TranslatableMarkup('Every comment on the ticket whose type is not "summary", oldest first (computed; never writable).'))
      ->setSetting('target_type', 'bb_comment')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setComputed(TRUE)
      ->setClass(HandoffCommentsItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    $fields['summary_comment'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Summary comment'))
      ->setDescription(new TranslatableMarkup('The newest comment on the ticket typed "summary" — the latest phase handoff (computed; never writable).'))
      ->setSetting('target_type', 'bb_comment')
      ->setCardinality(1)
      ->setComputed(TRUE)
      ->setClass(SummaryCommentItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    $fields['pending_reviews'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Pending reviews'))
      ->setDescription(new TranslatableMarkup('Submitted reviews awaiting a decision by the current assignee (computed; never writable).'))
      ->setSetting('target_type', 'bb_comment')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setComputed(TRUE)
      ->setClass(PendingReviewsItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    // Reverse references, read-only (parent_id / ticket_id are the source of
    // truth). Rendered by the ticket_detail full view's sub_tickets / runs
    // slots via entity_reference_entity_view, mirroring the comments field.
    $fields['sub_tickets'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Sub-tickets'))
      ->setSetting('target_type', 'bb_ticket')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setComputed(TRUE)
      ->setClass(SubTicketsItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    // Where the ticket is deployed: the deployment tickets carrying it.
    $fields['deployments'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Deployed to'))
      ->setDescription(new TranslatableMarkup('Deployment tickets whose referenced tickets contain this ticket (computed; never writable).'))
      ->setSetting('target_type', 'bb_ticket')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setComputed(TRUE)
      // Read directly by the inspector and the read tool; no display shows it.
      ->setClass(DeploymentsItemList::class);
    $fields['runs'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Runs'))
      ->setSetting('target_type', 'bb_run')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED)
      ->setComputed(TRUE)
      ->setClass(RunsItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    $fields['branch_name'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Branch name'))
      ->setDescription(new TranslatableMarkup('Git branch for the ticket. May be supplied at creation — that is how a ticket lands on an existing release or integration branch; left empty it is derived on first save from the repo branch convention (default feat/<identifier>-<title>, capped at 30 chars). Frozen once the ticket exists.'))
      ->setSetting('max_length', 255)
      ->addPropertyConstraints('value', ['Regex' => ['pattern' => BranchName::PATTERN]])
      ->setDisplayConfigurable('view', TRUE);
    $fields['base_branch'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Base branch'))
      ->setDescription(new TranslatableMarkup('Branch the ticket\'s work is based on (computed; never writable): the direct parent\'s branch_name when the ticket has a parent — so a child inherits its parent\'s release or integration branch — else the first project repo default_branch, else "main". Consumed by the conductor (worktree base) and the coding skill (MR target).'))
      ->setComputed(TRUE)
      ->setClass(BaseBranchItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    $fields['target_branch'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Target branch'))
      ->setDescription(new TranslatableMarkup("Branch the ticket's work merges into (computed; never writable): a deployment ticket with exactly one environment merges into that environment's branch, every other ticket into base_branch. Consumed by the forge tools (PR/MR target)."))
      ->setComputed(TRUE)
      ->setClass(TargetBranchItemList::class)
      ->setDisplayConfigurable('view', TRUE);
    $fields['frozen'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Frozen'))
      ->setDescription(new TranslatableMarkup('When set, conductors skip this ticket at the next claim. Setting it cancels the active runs.'))
      ->setDefaultValue(FALSE)
      ->setInitialValue(FALSE)
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayConfigurable('form', TRUE);
    $fields['frozen_at'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Frozen at'))
      ->setDescription(new TranslatableMarkup('When the operator hold started. Cleared when the ticket is unfrozen. Stamped by the server from `frozen`, never by the client.'))
      ->setDisplayConfigurable('view', TRUE)
      ->setDisplayConfigurable('form', TRUE);
    $fields['restarted_at'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Restarted at'))
      ->setDescription(new TranslatableMarkup('When the ticket was last released from the failed-run circuit breaker; the breaker counts only runs created after it. Stamped by the server, never by the client.'));
    $fields['restarted_by'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Restarted by'))
      ->setDescription(new TranslatableMarkup('Who last restarted the ticket. Stamped by the server, never by the client.'))
      ->setSetting('target_type', 'user');
    $fields['closed'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Closed'))
      ->setDescription(new TranslatableMarkup('Ticket is fully wound up; nothing more will happen. Distinct from the workflow state.'))
      ->setDefaultValue(FALSE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'boolean_checkbox', 'weight' => 15]);
    $fields['closed_date'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Closed date'))
      ->setDescription(new TranslatableMarkup('When the ticket was finalised.'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'datetime_timestamp', 'weight' => 16]);
    $fields['cleaned_up'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Cleaned up'))
      ->setDescription(new TranslatableMarkup("The ticket's herdr worktree has been torn down. Distinct from `closed`: `closed` is the ticket lifecycle, `cleaned_up` is the infra teardown, so a teardown miss keeps `cleaned_up`=FALSE (retried by the conductor reaper) without withholding the close."))
      ->setDefaultValue(FALSE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'boolean_checkbox', 'weight' => 17]);
    $fields['cleaned_up_date'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(new TranslatableMarkup('Cleaned up date'))
      ->setDescription(new TranslatableMarkup('When the worktree teardown was recorded. Distinct from `closed_date`: the two lifecycles are independent, so a ticket may be closed with this NULL, or this set while the ticket is still open.'))
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('form', ['type' => 'datetime_timestamp', 'weight' => 18]);
    // The owning account. Declared as the entity type's `owner` key so the
    // stock query-access handler and entity_jsonapi_entity_filter_access() can
    // both reason about it. Access-inert under
    // EntityPermissionProvider, which binds `view` to `view <type>` and leaves
    // the owner to the `own` variants of update/delete that no role holds.
    //
    // The default-value callback is not cosmetic: core marks the column of an
    // `owner` entity key NOT NULL, so a row created without one would fail to
    // save. Unlike bb_run — where the owner comes from the conductor and must
    // never follow the session (R3) — the acting account is the right default
    // here.
    $fields['owner_user_id'] = self::ownerBaseFieldDefinition()
      ->setSetting('handler', 'bb_assignee_in_ticket_workspace');
    return $fields;
  }

}
