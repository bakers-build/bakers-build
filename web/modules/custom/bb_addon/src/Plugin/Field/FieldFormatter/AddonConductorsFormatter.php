<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Plugin\Field\FieldFormatter;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_addon\AddonRepository;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The conductors running any version of an addon, as the viewer sees them.
 *
 * One badge per (conductor, version), newest version first. A conductor is
 * shown only when an access-checked query returns it AND its
 * project belongs to the routed workspace. The owner grant alone would show a
 * conductor the viewer runs in another workspace. Without a routed workspace
 * nothing is shown.
 */
#[FieldFormatter(
  id: 'bb_addon_conductors',
  label: new TranslatableMarkup('Addon conductors of the route workspace'),
  field_types: ['entity_reference'],
)]
final class AddonConductorsFormatter extends FormatterBase {

  /**
   * Conductor status → badge tone.
   */
  private const TONES = ['online' => 'running', 'offline' => 'offline'];

  /**
   * The entity type manager.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * The current route match.
   */
  private RouteMatchInterface $routeMatch;

  /**
   * Reads the sibling versions of the addon's name.
   */
  private AddonRepository $repository;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    $instance->routeMatch = $container->get('current_route_match');
    $instance->repository = $container->get('bb_addon.repository');
    return $instance;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   One badge per conductor, or a text when there is none.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $cache = (new CacheableMetadata())
      ->addCacheContexts(['user', 'route'])
      // Visibility follows the viewer's memberships and where projects sit;
      // a newly registered version of the name changes the cell.
      ->addCacheTags([
        'bb_conductor_list',
        'og_membership_list',
        'bb_project_list',
        'bb_group_list',
        'bb_addon_list',
      ]);
    $addon = $items->getEntity();
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    // Rows are scoped to the ROUTE's workspace, not the rendered addon's own
    // (BB-660/661): an admin viewing a cross-workspace entity directly must
    // still only see that route's conductors, never another workspace's.
    $rows = $addon instanceof BbAddonInterface && $workspace instanceof BbWorkspaceInterface
      ? $this->repository->rowsOf($addon->name(), (int) $workspace->id())
      : [];
    $visible = $this->visibleConductors($rows);
    $elements = [];
    $seen = [];
    foreach ($rows as $row) {
      foreach ($visible as $id => $conductor) {
        $key = $id . '@' . $row->version();
        if (isset($seen[$key]) || !$row->runsOn($conductor)) {
          continue;
        }
        $seen[$key] = TRUE;
        $cache->addCacheableDependency($conductor);
        $elements[] = [
          '#type' => 'component',
          '#component' => 'bb_theme:badge',
          '#props' => [
            'label' => $conductor->label() . ' ' . $row->version(),
            'tone' => self::TONES[$conductor->getStatus()] ?? 'neutral',
            'dot' => TRUE,
          ],
        ];
      }
    }
    if ($elements === []) {
      $elements[] = ['#plain_text' => (string) $this->t('No conductor in this workspace')];
    }
    $cache->applyTo($elements[0]);
    return $elements;
  }

  /**
   * The conductors of the rows the viewer sees in the routed workspace.
   *
   * @param \Drupal\bb_addon\Entity\BbAddonInterface[] $rows
   *   The rows of one addon name.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface[]
   *   The conductors keyed by id, sorted by label.
   */
  private function visibleConductors(array $rows): array {
    $ids = [];
    foreach ($rows as $row) {
      $ids = [...$ids, ...array_column($row->get('conductors')->getValue(), 'target_id')];
    }
    $ids = array_unique(array_filter($ids));
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if ($ids === [] || !$workspace instanceof BbWorkspaceInterface) {
      return [];
    }
    $storage = $this->entityTypeManager->getStorage('bb_conductor');
    $visible = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('id', $ids, 'IN')
      ->condition('project_id.entity:bb_project.group_id.entity:bb_group.workspace_id', $workspace->id())
      ->sort('label')
      ->execute();
    /** @var \Drupal\bb_core\Entity\BbConductorInterface[] */
    return $storage->loadMultiple($visible);
  }

}
