<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;
use Drupal\bb_core\Plugin\Field\FieldFormatter\EntityImageTrait;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The disclosed workspace list for the rail-head switcher.
 *
 * Each row is a link into that workspace's My work. The current ambient
 * workspace is marked `aria-current`, so the open panel names where the
 * reader already is rather than looking like a second destination.
 */
#[Source(
  id: 'bb_workspace_switcher_panel',
  label: new TranslatableMarkup('[bakers.build] Workspace switcher panel'),
  description: new TranslatableMarkup('Links to every workspace the signed-in account may enter.'),
  prop_types: ['slot'],
)]
final class BbWorkspaceSwitcherPanelSource extends SourcePluginBase {

  use EntityImageTrait;
  use WorkspaceSwitcherCandidatesTrait;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    $instance->readScope = $container->get(BbWorkspaceReadScopeInterface::class);
    $instance->currentUser = $container->get('current_user');
    $instance->workspaceContext = $container->get(AccountWorkspaceContext::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $ambient = $this->ambientWorkspace();
    $ambient_id = $ambient?->id();
    $build = [
      '#cache' => [
        'contexts' => ['user', 'route'],
        'tags' => ['bb_workspace_list', 'og_membership_list'],
      ],
    ];
    $cache = CacheableMetadata::createFromRenderArray($build);
    $this->workspaceContext->resolve($cache);
    foreach ($this->candidates() as $delta => $workspace) {
      $url = Url::fromRoute('view.tickets.my_work', [
        'bb_workspace' => $workspace->getSlug(),
      ])->toString(TRUE);
      $cache->addCacheableDependency($url);
      $build[$delta] = [
        '#type' => 'component',
        '#component' => 'bb_theme:menu_item',
        '#props' => [
          'label' => $workspace->label(),
          'url' => $url->getGeneratedUrl(),
          'current' => $ambient_id !== NULL && (string) $workspace->id() === (string) $ambient_id,
          // Each choice is recognisable by its image or initials.
          'mark' => [
            'initials' => $this->switcherInitials((string) $workspace->label()),
            'color' => $this->switcherColor((int) $workspace->id()),
            'picture' => $this->entityImageUrl($workspace, $cache, $this->entityTypeManager),
          ],
        ],
      ];
    }
    if ($ambient !== NULL) {
      $cache->addCacheableDependency($ambient);
    }
    $cache->applyTo($build);
    return $build;
  }

}
