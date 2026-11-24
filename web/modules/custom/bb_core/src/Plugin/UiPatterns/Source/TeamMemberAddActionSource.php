<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Members\MemberFaceOutcome;
use Drupal\ui_patterns\Attribute\Source;

/**
 * Opens the add-member dialog from the team Members page header.
 */
#[Source(
  id: 'bb_team_member_add_action',
  label: new TranslatableMarkup('[bakers.build] Add team member action'),
  description: new TranslatableMarkup('Opens the add-member dialog on the team Members screen.'),
  prop_types: ['slot'],
)]
final class TeamMemberAddActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'bb_core.bb_team.member_add';
  }

  /**
   * {@inheritdoc}
   */
  protected function dialogRouteParameters(): array {
    $team = $this->routeMatch->getParameter('bb_team');
    return $team instanceof BbTeamInterface ? ['bb_team' => (int) $team->id()] : [];
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Add member');
  }

  /**
   * {@inheritdoc}
   */
  protected function forwardsScreenQuery(): bool {
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerId(): string {
    return MemberFaceOutcome::ADD_ID;
  }

  /**
   * {@inheritdoc}
   */
  protected function appliesToCurrentRoute(): bool {
    return $this->routeMatch->getRouteName() === 'bb_core.bb_team.members'
      && $this->dialogRouteParameters() !== [];
  }

}
