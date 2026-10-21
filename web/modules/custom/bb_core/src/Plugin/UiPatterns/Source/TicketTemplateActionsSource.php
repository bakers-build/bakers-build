<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The detail screen's footer: Create ticket, opened in the overlay.
 *
 * Editing is the template's Settings tab, not a footer action.
 */
#[Source(
  id: 'bb_ticket_template_actions',
  label: new TranslatableMarkup('[bakers.build] Ticket template actions'),
  description: new TranslatableMarkup('Create a ticket from a ticket template.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket_template', label: new TranslatableMarkup('Ticket template'), required: TRUE),
  ],
)]
final class TicketTemplateActionsSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $template = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$template instanceof BbTicketTemplateInterface) {
      return [];
    }
    $cache = CacheableMetadata::createFromObject($template)->addCacheContexts(['user', 'url.path']);
    $build = [];

    // The template's own route parameters: access compares their workspace.
    $create = Url::fromRoute('bb_core.ticket_template_instantiate_form', $template->toUrl()->getRouteParameters());
    $create_access = $create->access(NULL, TRUE);
    $cache->addCacheableDependency($create_access);
    if ($template->isEnabled() && $create_access->isAllowed()) {
      // Opens in the overlay; the href is the page confirmation.
      $back = ['destination' => $template->toUrl()->toString()];
      $dialog = Url::fromRoute('bb_core.ticket_template_instantiate_form', $template->toUrl()->getRouteParameters(), ['query' => $back + ['_wrapper_format' => 'island_dialog']]);
      $build['create'] = $this->button((string) $this->t('Create ticket'), $create->setOption('query', $back)->toString(), 'primary');
      $build['create']['#props']['attributes'] = (new Htmx())->get($dialog)
        ->target('#' . CreateActionSourceBase::TARGET_ID)->select('dialog:not(dialog dialog)')->swap('innerHTML')->getAttributes();
      $build['create']['#attached']['library'] = ['core/drupal.htmx'];
    }
    $cache->applyTo($build);
    return $build;
  }

  /**
   * One footer button.
   *
   * @return array<string, mixed>
   *   The `bb_theme:button` render array.
   */
  private function button(string $label, string $href, string $variant): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => ['label' => $label, 'href' => $href, 'variant' => $variant],
    ];
  }

}
