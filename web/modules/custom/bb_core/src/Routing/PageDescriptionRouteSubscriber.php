<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Describes the core user pages, generic entity pages and bb_core-owned views.
 *
 * The page header shows the route default `_description` under the title;
 * a Views display has no setting for it, so it is set here.
 */
final class PageDescriptionRouteSubscriber extends RouteSubscriberBase {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'entity.bb_group.add_form' => 'Add a group to this workspace.',
    'entity.bb_group.canonical' => 'This group and its details.',
    'entity.bb_group.edit_form' => "Change this group's details.",
    'entity.bb_group.delete_form' => 'Confirm the deletion of this group.',
    'entity.bb_environment.edit_form' => "Change this environment's details.",
    'entity.bb_environment.delete_form' => 'Confirm the deletion of this environment.',
    'entity.bb_workspace.delete_form' => 'Confirm the deletion of this workspace.',
    'entity.user.canonical' => 'This account and its details.',
    'entity.user.edit_form' => "Change this account's settings.",
    'entity.user.cancel_form' => 'Confirm the cancellation of this account.',
    'user.cancel_confirm' => 'Confirm the cancellation of your account.',
    'view.addons.settings' => 'The addons available to this workspace, with the conductors that run them.',
    'view.bb_environments.project_list' => 'The environments of this project.',
    'view.bb_terms.types' => 'The ticket types of this workspace.',
    'view.bb_terms.recipes' => 'The recipes of this workspace.',
    'view.bb_terms.labels' => 'The ticket labels of this workspace.',
    'view.bb_ticket_templates.project_list' => 'The ticket templates of this project.',
    'view.bb_ticket_templates.workspace_list' => 'The ticket templates of this workspace and its projects.',
    'view.conductors.project_list' => 'The conductors of this project.',
    'view.conductors.user_list' => 'The conductors assigned to this account, in every workspace.',
    'view.machines.user_list' => 'The machines assigned to this account, in every workspace.',
    'view.groups.workspace_list' => 'The groups of this workspace; a group grants no permissions of its own.',
    'view.projects.workspace_list' => 'The projects of this workspace.',
    'view.runs.project_runs' => "The runs of this project's tickets.",
    'view.runs.team_runs' => "The runs of this team's tickets.",
    'view.tickets.my_work' => 'The tickets assigned to you in this workspace.',
    'view.tickets.page_1' => 'Every ticket in this workspace.',
    'view.tickets.project_tickets' => 'The tickets of this project.',
    'view.tickets.team_tickets' => 'The tickets this team works on.',
  ];

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    foreach (self::DESCRIPTIONS as $name => $description) {
      $collection->get($name)?->setDefault('_description', $description);
    }
  }

}
