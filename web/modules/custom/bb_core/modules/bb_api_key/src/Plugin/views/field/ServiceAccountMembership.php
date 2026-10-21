<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\views\field;

use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\user\UserInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Renders the "Workspace role · Team (team role)" summary for one row.
 */
#[ViewsField('bb_service_account_membership')]
final class ServiceAccountMembership extends FieldPluginBase {

  /**
   * Reads each row's workspace, team and role names.
   */
  protected ServiceAccountManager $serviceAccountManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->serviceAccountManager = $container->get(ServiceAccountManager::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return string
   *   The membership summary; empty for a non-user row.
   */
  public function render(ResultRow $values) {
    $user = $this->getEntity($values);
    if (!$user instanceof UserInterface) {
      return '';
    }
    $workspace = $this->serviceAccountManager->workspace($user);
    if ($workspace === NULL) {
      return '';
    }
    $workspaceRole = $this->serviceAccountManager->roleName($workspace, $user) ?? 'member';
    $team = $this->serviceAccountManager->team($user);
    if (!$team instanceof BbTeamInterface) {
      return (string) $this->t('@role, no team', ['@role' => ucfirst($workspaceRole)]);
    }
    $teamRole = $this->serviceAccountManager->roleName($team, $user) ?? 'member';
    return (string) $this->t('@role · @team (@team_role)', [
      '@role' => ucfirst($workspaceRole),
      '@team' => $team->label(),
      '@team_role' => ucfirst($teamRole),
    ]);
  }

}
