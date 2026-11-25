<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Members\InviteInspectorRows;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The Properties block of an invitation's detail.
 */
#[Source(
  id: 'bb_invite_inspector',
  label: new TranslatableMarkup('[bakers.build] Invitation properties'),
  description: new TranslatableMarkup('The address, role, team, inviter and expiry of an invitation.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_invite', label: new TranslatableMarkup('Invitation'), required: TRUE),
  ],
)]
final class BbInviteInspectorSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Builds the rail's rows.
   */
  protected InviteInspectorRows $inspectorRows;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->inspectorRows = new InviteInspectorRows($container->get('bb_core.workspace_invite'), $container->get('bb_core.date'));
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $invite = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$invite instanceof BbInvite) {
      return [];
    }
    $build = $this->inspectorRows->propertiesBlock($this->inspectorRows->build($invite));
    // Expired is a matter of time, so the status ages by the day.
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($invite)
      ->addCacheContexts(['user'])
      ->addCacheTags($this->tags())
      ->setCacheMaxAge(86400)
      ->applyTo($build);
    return $build;
  }

  /**
   * The role and team label tags the rows depend on.
   *
   * @return array<int, string>
   *   The tags.
   */
  private function tags(): array {
    return ['og_role_list', 'bb_team_list', 'user_list'];
  }

}
