<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Form\BbContentEntityFormBase;
use Drupal\bb_core\Form\OverlayTrigger;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The trigger page's footer: Edit, Pause or Resume, and Delete.
 *
 * Edit and Pause/Resume return to the page; Delete returns to the list.
 */
#[Source(
  id: 'bb_ticket_trigger_actions',
  label: new TranslatableMarkup('[bakers.build] Ticket trigger actions'),
  description: new TranslatableMarkup('Edit, pause, resume or delete a ticket trigger.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket_trigger', label: new TranslatableMarkup('Ticket trigger'), required: TRUE),
  ],
)]
final class BbTicketTriggerActionsSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $trigger = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$trigger instanceof BbTicketTriggerInterface) {
      return [];
    }
    $cache = CacheableMetadata::createFromObject($trigger)->addCacheContexts(['user', 'url.path']);
    $back = ['query' => ['destination' => $trigger->toUrl()->toString()]];
    $build = [];
    $update = $trigger->access('update', NULL, TRUE);
    $cache->addCacheableDependency($update);
    if ($update->isAllowed()) {
      $build['edit'] = $this->button((string) $this->t('Edit'), $trigger->toUrl('edit-form', $back), 'neutral');
    }
    $toggle = $trigger->access('toggle', NULL, TRUE);
    $cache->addCacheableDependency($toggle);
    if ($toggle->isAllowed()) {
      // The confirmation opens over this page; the href is the page form.
      $url = Url::fromRoute('entity.bb_ticket_trigger.toggle_form', $trigger->toUrl('edit-form')->getRouteParameters(), $back);
      $build['toggle'] = $this->button((string) ($trigger->isEnabled() ? $this->t('Pause') : $this->t('Resume')), $url, 'neutral');
      $build['toggle']['#props']['attributes'] = new Attribute(OverlayTrigger::attributes($url));
      $build['toggle']['#attached']['library'] = ['core/drupal.htmx'];
    }
    $build += BbContentEntityFormBase::deleteAction($trigger);
    $cache->applyTo($build);
    return $build;
  }

  /**
   * One footer button.
   *
   * @return array<string, mixed>
   *   The `bb_theme:button` render array.
   */
  private function button(string $label, Url $url, string $variant): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => ['label' => $label, 'href' => $url->toString(), 'variant' => $variant],
    ];
  }

}
