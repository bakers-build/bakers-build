<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Menu\MenuLinkTreeInterface;
use Drupal\Core\Menu\MenuTreeParameters;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;
use Drupal\bb_core\Plugin\Menu\AmbientScopedMenuLinkInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\Plugin\UiPatterns\Source\MenuSource;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\ui_patterns\SourcePluginManager;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The ui_patterns `menu` source, shaped for `bb_theme:nav`.
 *
 * Differences from contrib's `MenuSource`:
 * - links implementing `AmbientScopedMenuLinkInterface` are access-checked by
 *   their request context before core generates their URL;
 * - an item is current when its URL is the current page's URL, or when the
 *   current route is listed in the link's `active_routes` option;
 * - the item shape is nav's (`icon`, `heading`, `open`, `mark`, `action`,
 *   `full_page`, `at_end` come from link options);
 * - a link with the option `bb_children: teams` gets the ambient
 *   workspace's teams as children and the team create action, both resolved
 *   per request. Teams are not menu links.
 *
 * ponytail: the ambient access step only runs here. Another renderer of these
 * menus (e.g. `system_menu_block`) would show headings and `<nolink>` rows.
 */
#[Source(
  id: 'bb_menu',
  label: new TranslatableMarkup('[bakers.build] Ambient menu'),
  description: new TranslatableMarkup('A menu with request-context links, shaped for the navigation rail.'),
  prop_types: ['links'],
)]
final class BbMenuSource extends MenuSource {

  /**
   * Resolves the route workspace or the validated profile origin.
   */
  private AccountWorkspaceContext $workspaceContext;

  /**
   * Builds the team create action.
   */
  private SourcePluginManager $sourceManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $plugin = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    assert($plugin instanceof self);
    $plugin->workspaceContext = $container->get(AccountWorkspaceContext::class);
    $plugin->sourceManager = $container->get('plugin.manager.ui_patterns_source');
    return $plugin;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $menu_id = $this->getSetting('menu');
    if (!$menu_id) {
      return [];
    }
    $this->menuId = $menu_id;
    assert($this->menuLinkTree instanceof MenuLinkTreeInterface);
    $level = (int) ($this->getSetting('level') ?: 1);
    $depth = (int) $this->getSetting('depth');
    $parameters = (new MenuTreeParameters())->setMinDepth($level);
    if ($depth > 0) {
      $parameters->setMaxDepth(min($level + $depth - 1, $this->menuLinkTree->maxDepth()));
    }
    $tree = $this->menuLinkTree->load($menu_id, $parameters);
    $tree = $this->menuLinkTree->transform(self::applyAmbientAccess($tree), [
      ['callable' => 'menu.default_tree_manipulators:checkAccess'],
      ['callable' => 'menu.default_tree_manipulators:generateIndexAndSort'],
    ]);
    $built = $this->menuLinkTree->build($tree);
    return $this->navItems($built['#items'] ?? [], $this->currentUrl());
  }

  /**
   * {@inheritdoc}
   *
   * Contrib calls this on its own instance before `getPropValue()`, so every
   * cache term is declared here rather than taken from the built tree.
   */
  public function alterComponent(array $element): array {
    $this->menuId = $this->getSetting('menu');
    $element = parent::alterComponent($element);
    $action = $this->teamCreateAction();
    $element['#attached']['library'] = array_merge($element['#attached']['library'] ?? [], $action['#attached']['library'] ?? []);
    $cache = CacheableMetadata::createFromRenderArray($element)
      ->merge(CacheableMetadata::createFromRenderArray($action))
      // Team rows come from an access-checked query, and link access depends
      // on permissions and memberships.
      ->addCacheTags(['bb_team_list', 'og_membership_list'])
      ->addCacheContexts(['user', 'user.permissions', 'route']);
    $this->workspaceContext->resolve($cache);
    $cache->applyTo($element);
    return $element;
  }

  /**
   * Sets the request-context access of ambient links before core checks.
   *
   * @param \Drupal\Core\Menu\MenuLinkTreeElement[] $tree
   *   The loaded tree.
   *
   * @return \Drupal\Core\Menu\MenuLinkTreeElement[]
   *   The same tree; core's `checkAccess` keeps an access result already set.
   */
  private static function applyAmbientAccess(array $tree): array {
    foreach ($tree as $element) {
      if ($element->link instanceof AmbientScopedMenuLinkInterface) {
        $element->access = $element->link->ambientAccess();
      }
      if ($element->subtree && ($element->access === NULL || $element->access->isAllowed())) {
        $element->subtree = self::applyAmbientAccess($element->subtree);
      }
    }
    return $tree;
  }

  /**
   * Converts one level of `#items` to `bb_theme:nav` items.
   *
   * @param array<string, mixed> $items
   *   `MenuLinkTree::build()`'s `#items`.
   * @param string|null $here
   *   The current page's URL, NULL when it cannot be generated.
   *
   * @return array<int, array<string, mixed>>
   *   Link items in the `links` vocabulary.
   */
  private function navItems(array $items, ?string $here): array {
    $route_name = $this->routeMatch->getRouteName();
    $result = [];
    foreach ($items as $element) {
      $options = $element['original_link']->getOptions();
      $entry = [
        'title' => (string) $element['title'],
        'icon' => $options['icon'] ?? NULL,
        'in_active_trail' => FALSE,
        'below' => $this->navItems($element['below'] ?? [], $here),
      ];
      if (!empty($options['heading'])) {
        $entry['heading'] = TRUE;
        $entry['open'] = !empty($options['open']);
      }
      if (empty($options['heading'])) {
        $entry['url'] = $element['url']->toString();
        $entry['in_active_trail'] = $entry['url'] === $here || in_array($route_name, $options['active_routes'] ?? [], TRUE);
      }
      foreach (['mark', 'full_page', 'at_end'] as $key) {
        if (!empty($options[$key])) {
          $entry[$key] = $options[$key];
        }
      }
      if (($options['bb_children'] ?? NULL) === 'teams') {
        $entry['below'] = array_merge($entry['below'], $this->teamItems());
        $action = $this->teamCreateAction();
        if (isset($action['#props'])) {
          $entry['action'] = $action['#props'] + ['icon' => 'plus'];
        }
        elseif ($entry['below'] === []) {
          continue;
        }
      }
      // A parent of the current entry is in the trail, so its panel opens.
      $entry['in_active_trail'] = in_array(TRUE, array_column([$entry, ...$entry['below']], 'in_active_trail'), TRUE);
      $result[] = $entry;
    }
    return $result;
  }

  /**
   * One item per team of the ambient workspace, in label order.
   *
   * @return array<int, array<string, mixed>>
   *   Link items in the `links` vocabulary.
   */
  private function teamItems(): array {
    $workspace = $this->workspaceContext->resolve(new CacheableMetadata());
    if (!$workspace instanceof BbWorkspaceInterface) {
      // Without an ambient workspace, listing teams would disclose every
      // tenant's.
      return [];
    }
    $current = $this->routeMatch->getParameter('bb_team');
    $current_id = $current instanceof BbTeamInterface ? (int) $current->id() : NULL;
    $on_tickets = $this->routeMatch->getRouteName() === 'view.tickets.team_tickets';
    $storage = $this->entityTypeManager->getStorage('bb_team');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('workspace_id', $workspace->id())
      ->sort('name')
      ->execute();
    $items = [];
    foreach ($storage->loadMultiple($ids) as $team) {
      if (!$team instanceof BbTeamInterface) {
        continue;
      }
      $is_current = (int) $team->id() === $current_id;
      $items[] = [
        'title' => (string) $team->label(),
        'url' => $team->toUrl()->toString(),
        'in_active_trail' => $is_current,
        'mark' => [
          'initials' => self::markInitials((string) $team->label()),
          'color' => self::markColor((int) $team->id()),
        ],
        // The query applied bb_team.view, and the Tickets route applies the
        // same entity access check.
        'below' => [
          [
            'title' => (string) $this->t('Tickets'),
            'url' => Url::fromRoute('view.tickets.team_tickets', [
              'bb_workspace' => $workspace->getSlug(),
              'bb_team' => $team->id(),
            ])->toString(),
            'icon' => 'ticket',
            'in_active_trail' => $is_current && $on_tickets,
            'below' => [],
          ],
        ],
      ];
    }
    return $items;
  }

  /**
   * The team create action's props and render dependencies.
   *
   * @return array<string, mixed>
   *   The create action, or cache metadata alone when forbidden.
   */
  private function teamCreateAction(): array {
    $source = $this->sourceManager->createInstance('bb_team_create_action', SourcePluginBase::buildConfiguration('actions', ['type' => 'object'], ['source' => []], []));
    assert($source instanceof SourcePluginBase);
    return $source->getPropValue();
  }

  /**
   * The current page's URL, as links generate it.
   */
  private function currentUrl(): ?string {
    if ($this->routeMatch->getRouteName() === NULL) {
      return NULL;
    }
    try {
      return Url::fromRoute('<current>')->toString();
    }
    catch (\Throwable) {
      return NULL;
    }
  }

  /**
   * The first letter of each of the first two words of a team name.
   */
  private static function markInitials(string $name): string {
    $parts = preg_split('/\s+/', trim($name)) ?: [];
    $letters = array_map(
      static fn (string $part): string => mb_strtoupper(mb_substr($part, 0, 1)),
      $parts,
    );
    return implode('', array_slice($letters, 0, 2));
  }

  /**
   * One of the `person` colour keys, derived from the team id.
   */
  private static function markColor(int $id): string {
    $colors = ['running', 'attention', 'unassigned', 'lease', 'offline'];
    return $colors[$id % count($colors)];
  }

}
