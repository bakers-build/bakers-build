<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;
use Drupal\bb_core\Plugin\Field\FieldFormatter\EntityImageTrait;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The ambient workspace's switcher props, with no entity context.
 *
 * The shell placement is not rendering a workspace entity — it is decorating
 * every page with whichever workspace the route named — so there is no bound
 * entity for a generic field source. This answers `workspace_label`,
 * `workspace_initials`, `workspace_color`, `workspace_picture` and `multiple`
 * from the route match and the account's read scope. The picture follows the
 * listing avatar's rule: shown only where the reader may see the image.
 */
#[Source(
  id: 'bb_workspace_switcher',
  label: new TranslatableMarkup('[bakers.build] Workspace switcher props'),
  description: new TranslatableMarkup('The ambient workspace identity and whether the account can switch.'),
  prop_types: ['string', 'enum', 'boolean'],
)]
final class BbWorkspaceSwitcherSource extends SourcePluginBase {

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
  public function alterComponent(array $element): array {
    $element = parent::alterComponent($element);
    $cache = CacheableMetadata::createFromRenderArray($element);
    $cache->addCacheContexts(['user', 'route']);
    $cache->addCacheTags(['bb_workspace_list', 'og_membership_list']);
    $ambient = $this->workspaceContext->resolve($cache);
    if ($ambient !== NULL) {
      // Also collects the image's field and file access.
      $this->entityImageUrl($ambient, $cache, $this->entityTypeManager);
    }
    $cache->applyTo($element);
    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $ambient = $this->ambientWorkspace();
    $name = $ambient ? (string) $ambient->label() : '';
    return match ($this->getPropId()) {
      'workspace_label' => $name !== '' ? $name : (string) $this->t('Workspaces'),
      'workspace_initials' => $name === '' ? 'W' : $this->switcherInitials($name),
      'workspace_color' => $ambient ? $this->switcherColor((int) $ambient->id()) : 'running',
      'workspace_picture' => $ambient ? $this->entityImageUrl($ambient, new CacheableMetadata(), $this->entityTypeManager) : '',
      'multiple' => count($this->candidates()) > 1,
      default => '',
    };
  }

}
