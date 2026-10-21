<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Routing\RedirectDestinationInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Ticket template operations: Create ticket, and Edit named Settings.
 */
final class TicketTemplateOperationsHooks {

  use StringTranslationTrait;

  public function __construct(
    #[Autowire(service: 'redirect.destination')]
    private readonly RedirectDestinationInterface $redirectDestination,
  ) {}

  /**
   * Links the instantiate confirm form next to Edit/Delete.
   *
   * @return array<string, array<string, mixed>>
   *   The operations to merge into the entity's operations list.
   */
  #[Hook('entity_operation')]
  public function entityOperation(EntityInterface $entity, CacheableMetadata $cacheability): array {
    if (!$entity instanceof BbTicketTemplateInterface) {
      return [];
    }
    $cacheability->addCacheableDependency($entity);
    if (!$entity->isEnabled() || !$entity->access('view')) {
      return [];
    }
    // The dialog's destination is the listing it is opened over.
    $cacheability->addCacheContexts(['url.path', 'url.query_args']);
    $parameters = $entity->toUrl()->getRouteParameters();
    // Opens in the overlay, as on the detail screen; the href is the page.
    $dialog = Url::fromRoute('bb_core.ticket_template_instantiate_form', $parameters, [
      'query' => $this->redirectDestination->getAsArray() + ['_wrapper_format' => 'island_dialog'],
    ]);
    $attributes = (new Htmx())->get($dialog)
      ->target('#' . CreateActionSourceBase::TARGET_ID)->select('dialog:not(dialog dialog)')->swap('innerHTML')
      ->getAttributes()->toArray();
    return [
      'instantiate' => [
        'title' => $this->t('Create ticket'),
        'weight' => -10,
        'url' => Url::fromRoute('bb_core.ticket_template_instantiate_form', $parameters, ['attributes' => $attributes]),
      ],
    ];
  }

  /**
   * Names the edit operation after the screen it opens: the Settings tab.
   *
   * @param array<string, array<string, mixed>> $operations
   *   The entity's operations, altered in place.
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity the operations belong to.
   */
  #[Hook('entity_operation_alter')]
  public function entityOperationAlter(array &$operations, EntityInterface $entity): void {
    if (!$entity instanceof BbTicketTemplateInterface || !isset($operations['edit'])) {
      return;
    }
    $operations['edit']['title'] = $this->t('Settings');
    $url = $operations['edit']['url'];
    if ($url instanceof Url) {
      $url->setOption('attributes', ['aria-label' => $this->t('Settings @label', ['@label' => $entity->label()])] + ($url->getOption('attributes') ?: []));
    }
  }

}
