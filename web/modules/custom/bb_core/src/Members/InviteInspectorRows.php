<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Inspector\InspectorRows;
use Drupal\bb_core\Time\BbDate;
use Drupal\user\UserInterface;

/**
 * An invitation detail's properties: who, which role and team, by whom, until.
 */
final class InviteInspectorRows extends InspectorRows {

  public function __construct(
    private readonly WorkspaceInvite $invites,
    private readonly BbDate $date,
  ) {}

  /**
   * Builds the rail's `items` array.
   *
   * @return array<string, array<string, mixed>>
   *   List items keyed by row.
   */
  public function build(BbInvite $invite): array {
    $inviter = $invite->get('owner_user_id')->entity;
    // The roster row's own values, so the two never disagree.
    $cells = $this->invites->inviteItems([$invite])['items'][0]['cells'];
    return [
      'email' => $this->row('E-mail address', $this->text($invite->getEmail())),
      'role' => $this->row('Role', $cells['role']),
      'team' => $this->row('Team', $cells['team']),
      'inviter' => $this->row('Invited by', $this->text($inviter instanceof UserInterface && $inviter->access('view label') ? (string) $inviter->getDisplayName() : '')),
      'status' => $this->row('Status', $cells['joined']),
      'expires' => $this->row('Expires', $this->date->cell($invite->getCreatedTime() + WorkspaceInvite::VALIDITY_DAYS * 86400)),
    ];
  }

}
