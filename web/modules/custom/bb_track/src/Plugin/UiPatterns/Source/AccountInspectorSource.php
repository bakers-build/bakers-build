<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Inspector\AccountInspectorRows;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The Properties block of a billing account's detail.
 */
#[Source(
  id: 'bb_track_account_inspector',
  label: new TranslatableMarkup('[bakers.build] Billing account properties'),
  description: new TranslatableMarkup('The state, terms and tickets of a billing account.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_track_account', label: new TranslatableMarkup('Billing account'), required: TRUE),
  ],
)]
final class AccountInspectorSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $billing_account = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$billing_account instanceof Account) {
      return [];
    }
    $rows = new AccountInspectorRows();
    $build = $rows->propertiesBlock($rows->build($billing_account));
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($billing_account)
      ->addCacheContexts(['user'])
      ->addCacheTags(['bb_ticket_list'])
      ->applyTo($build);
    return $build;
  }

}
