<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Drupal\bb_core\ParamConverter\BbWorkspaceSlugConverter;
use Drupal\bb_core\PathProcessor\BbWorkspacePathProcessor;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/**
 * Wires every workspace-prefixed route: converters, patterns, check, theme.
 *
 * One seam for entity-link routes and module routing.yml routes alike, so
 * they cannot drift into checking tenancy differently. Membership is decided
 * by the path prefix, not by route names.
 *
 * Applies the slug converter and pattern, the human-reference converters on
 * {bb_ticket}/{bb_project}, the UUID converter on {bb_comment}, the
 * `_bb_workspace_match` requirement, and `_admin_route: FALSE`, because the
 * entity module's AdminHtmlRouteProvider marks add/edit/delete forms as admin
 * routes by name, whatever the path.
 *
 * The route builder assigns parameter converters only after this ALTER pass
 * and skips any slot that already names one, so setting them here wins.
 *
 * One named exception outside the prefix: the account edit form is also
 * taken out of the admin theme, so it renders in the app shell. Its access
 * requirements stay core's; no workspace treatment is applied.
 */
final class BbWorkspaceRouteSubscriber extends RouteSubscriberBase {

  /**
   * The path prefix that marks a route as workspace-scoped.
   *
   * The INTERNAL form. The public URL is `/{workspace}/…`; Drupal's router
   * cannot match a leading variable segment, so the routes carry a static
   * `/_workspace` first segment that BbWorkspacePathProcessor adds on the way
   * in and strips on the way out. Membership is still decided by the path, so a
   * route that loses the prefix loses the treatment in the same commit.
   */
  private const WORKSPACE_PREFIX = '/' . BbWorkspacePathProcessor::PREFIX . '/{bb_workspace}';

  /**
   * The slug pattern, mirroring BbWorkspaceSlugConstraint::PATTERN.
   *
   * A requirement as well as a constraint: the constraint governs what may be
   * SAVED, this governs what may MATCH. It is also what makes the internal
   * prefix unaddressable — BbWorkspacePathProcessor turns a request that
   * names `/_workspace` into one whose workspace slot would be `_workspace`,
   * and an underscore fails this pattern, so nothing matches and it 404s.
   */
  private const SLUG_PATTERN = '[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?';

  /**
   * Matches a UUID — one of the three forms an entity slot may still take.
   */
  private const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

  /**
   * The human-reference slots, with their converter and their pattern.
   *
   * Each pattern is `entity id | UUID | human reference`. The reference halves
   * are written so they cannot match `add` — a ticket identifier always
   * carries a hyphen and a project key is at least two characters and starts
   * with a letter, while `…/ticket/add` and its project twin are static
   * sibling paths. Route fit ordering already prefers the static
   * route, but a pattern that also excludes the collision means the ordering
   * is a convenience rather than the only thing standing between an Add link
   * and a 404.
   *
   * @var array<string, array{converter: string, pattern: string}>
   */
  private const REFERENCE_SLOTS = [
    'bb_ticket' => [
      'converter' => 'bb_core.paramconverter.ticket_identifier',
      'pattern' => '\d+|' . self::UUID . '|[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+',
    ],
    'bb_project' => [
      'converter' => 'bb_core.paramconverter.project_key',
      'pattern' => '\d+|' . self::UUID . '|[A-Za-z][A-Za-z0-9]{1,9}',
    ],
  ];

  /**
   * UUID-addressed slots that have no human reference.
   *
   * @var array<string, array{converter: string, pattern: string}>
   */
  private const UUID_SLOTS = [
    'bb_comment' => [
      'converter' => 'bb_core.paramconverter.entity_uuid',
      'pattern' => '\d+|' . self::UUID,
    ],
  ];

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    $this->removeOgAdminRoutes($collection);
    // Core marks the account edit form as an admin route; Island skips admin
    // routes, so without this the form renders outside the app shell.
    $account_edit = $collection->get('entity.user.edit_form');
    if ($account_edit !== NULL) {
      $this->makeFrontEnd($account_edit);
    }
    foreach ($collection as $name => $route) {
      if (!str_starts_with($route->getPath(), self::WORKSPACE_PREFIX)) {
        continue;
      }
      $parameters = $route->getOption('parameters') ?? [];
      if ($route->hasOption('_view_argument_map')) {
        $parameters = $this->gateViewsRoute($name, $route, $parameters);
      }
      $parameters['bb_workspace'] = [
        'type' => BbWorkspaceSlugConverter::TYPE,
        'converter' => 'bb_core.paramconverter.workspace_slug',
      ];
      foreach (self::REFERENCE_SLOTS + self::UUID_SLOTS as $name => $slot) {
        if (!isset($parameters[$name])) {
          continue;
        }
        $parameters[$name]['converter'] = $slot['converter'];
        $route->setRequirement($name, $slot['pattern']);
      }
      $route->setOption('parameters', $parameters);
      $route->setRequirement('bb_workspace', self::SLUG_PATTERN);
      $route->setRequirement('_bb_workspace_match', 'TRUE');
      $this->makeFrontEnd($route);
    }
  }

  /**
   * Settings tabs that keep their own Views access instead of the lead gate.
   *
   * Contributors use workspace templates, so their tab stays open to every
   * reader of templates in that workspace.
   *
   * @var array<string, string>
   *   The permission each tab requires in the route's workspace, by route.
   */
  private const OPEN_SETTINGS_VIEWS = ['view.bb_ticket_templates.workspace_list' => 'view bb_ticket_template'];

  /**
   * Gives a Views-owned route the access and context of its place.
   *
   * A detail listing keeps the detail entity's view access and context; a
   * tab under workspace settings carries the settings gate, except the ones
   * in OPEN_SETTINGS_VIEWS.
   *
   * @param string $name
   *   The route name.
   * @param \Symfony\Component\Routing\Route $route
   *   The Views route.
   * @param array<string, mixed> $parameters
   *   The route's parameter options.
   *
   * @return array<string, mixed>
   *   The parameter options, with the detail entity's converter.
   */
  private function gateViewsRoute(string $name, Route $route, array $parameters): array {
    foreach (['bb_project', 'bb_team', 'bb_ticket_template'] as $entity_type) {
      if (str_contains($route->getPath(), '{' . $entity_type . '}')) {
        $parameters[$entity_type] = ['type' => 'entity:' . $entity_type];
        $route->setRequirement('_entity_access', $entity_type . '.view');
      }
    }
    if (isset(self::OPEN_SETTINGS_VIEWS[$name])) {
      $route->setRequirement('_bb_workspace_permission', self::OPEN_SETTINGS_VIEWS[$name]);
    }
    elseif (str_starts_with($route->getPath(), self::WORKSPACE_PREFIX . '/settings/')) {
      $route->setRequirement('_entity_access', 'bb_workspace.update');
    }
    return $parameters;
  }

  /**
   * Drops OG's group-management routes from bakers.build's own entity types.
   *
   * `og_entity_type_alter()` adds an `og-admin-routes` template to every
   * entity type, and `OgLocalTask` turns each route into a "Group management"
   * tab. bakers.build's Members tab already does that job, so the route is removed
   * (which removes the tab) rather than gated. Only `bb_*` types are
   * touched; the others belong to their own modules.
   *
   * @param \Symfony\Component\Routing\RouteCollection $collection
   *   The route collection to alter.
   */
  private function removeOgAdminRoutes(RouteCollection $collection): void {
    foreach ($collection as $name => $route) {
      if (!str_contains($name, '.og_admin_routes')) {
        continue;
      }
      $entity_type_id = (string) $route->getOption('_og_entity_type_id');
      if (str_starts_with($entity_type_id, 'bb_')) {
        $collection->remove($name);
      }
    }
  }

  /**
   * Takes a route out of the admin theme.
   *
   * Set to FALSE rather than unset, so a later ALTER subscriber cannot read
   * "no opinion" and stamp TRUE back on. The default theme is bb_theme, so
   * a non-admin route already resolves to it.
   *
   * @param \Symfony\Component\Routing\Route $route
   *   The route to mark as front end.
   */
  private function makeFrontEnd(Route $route): void {
    $route->setOption('_admin_route', FALSE);
  }

}
