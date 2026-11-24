<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The API key page's footer: Revoke, then back to the key list.
 *
 * A personal key is revoked through the owner's own confirmation, a service
 * account's key through its workspace's; never contrib's administrator
 * delete route. Each keeps its own route access.
 */
#[Source(
  id: 'bb_api_key_actions',
  label: new TranslatableMarkup('[bakers.build] API key actions'),
  description: new TranslatableMarkup('Revoke an API key.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:consumer', label: new TranslatableMarkup('API key'), required: TRUE),
  ],
)]
final class ApiKeyActionsSource extends SourcePluginBase {

  /**
   * Resolves a service account's workspace.
   */
  protected ServiceAccountManager $serviceAccountManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->serviceAccountManager = $container->get(ServiceAccountManager::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $key = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$key instanceof ConsumerInterface) {
      return [];
    }
    $owner = $key->get('owner_id')->entity;
    if (!$owner instanceof UserInterface) {
      return [];
    }
    $workspace = $this->serviceAccountManager->workspace($owner);
    $revoke = $workspace === NULL
      ? Url::fromRoute('bb_api_key.delete', ['user' => $owner->id(), 'consumer' => $key->id()])
      : Url::fromRoute('bb_api_key.service_account.key_revoke', [
        'bb_workspace' => $workspace->getSlug(),
        'user' => $owner->id(),
        'consumer' => $key->id(),
      ]);
    $access = $revoke->access(NULL, TRUE);
    $build = [];
    if ($access->isAllowed()) {
      $build['revoke'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => ['label' => (string) $this->t('Revoke'), 'href' => $revoke->toString(), 'variant' => 'danger'],
      ];
    }
    CacheableMetadata::createFromObject($key)->addCacheableDependency($access)->applyTo($build);
    return $build;
  }

}
