<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\bb_core\Form\BbContentEntityFormBase;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The term page's footer: Edit, back to the page, and Delete.
 */
#[Source(
  id: 'bb_term_actions',
  label: new TranslatableMarkup('[bakers.build] Term actions'),
  description: new TranslatableMarkup('Edit or delete a term.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_term', label: new TranslatableMarkup('Term'), required: TRUE),
  ],
)]
final class BbTermActionsSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $term = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$term instanceof BbTermInterface) {
      return [];
    }
    $build = [];
    if ($term->access('update')) {
      $build['edit'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'label' => (string) $this->t('Edit'),
          'href' => $term->toUrl('edit-form', ['query' => ['destination' => $term->toUrl()->toString()]])->toString(),
          'variant' => 'neutral',
        ],
      ];
    }
    $build += BbContentEntityFormBase::deleteAction($term);
    CacheableMetadata::createFromObject($term)->addCacheContexts(['user', 'url.path'])->applyTo($build);
    return $build;
  }

}
