<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Hook;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTargetInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerRunner;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerTargetPluginManager;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Ticket trigger lifecycle: cron, Pause/Resume, removal with the target.
 */
final class TicketTriggerHooks {

  use StringTranslationTrait;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    #[Autowire(service: 'bb_ticket_trigger.runner')]
    private readonly TicketTriggerRunner $runner,
    #[Autowire(service: 'plugin.manager.bb_ticket_trigger_target')]
    private readonly TicketTriggerTargetPluginManager $targetManager,
  ) {}

  /**
   * Adds Pause or Resume next to Edit and Delete.
   *
   * @return array<string, array<string, mixed>>
   *   The operations to merge into the trigger's operations list.
   */
  #[Hook('entity_operation')]
  public function entityOperation(EntityInterface $entity, CacheableMetadata $cacheability): array {
    if (!$entity instanceof BbTicketTriggerInterface) {
      return [];
    }
    $cacheability->addCacheableDependency($entity);
    $access = $entity->access('toggle', NULL, TRUE);
    $cacheability->addCacheableDependency($access);
    if (!$access->isAllowed()) {
      return [];
    }
    // The confirmation opens in the overlay, as a template's Create ticket
    // does; the href stays the page form. The destination is the Triggers tab
    // itself, not the request: a boosted list's query carries htmx's
    // `ajax_page_state`.
    $parameters = $entity->toUrl('edit-form')->getRouteParameters();
    $list = $entity->getTargetPlugin()->listUrl($entity);
    $query = $list === NULL ? [] : ['destination' => $list->toString()];
    $dialog = Url::fromRoute('entity.bb_ticket_trigger.toggle_form', $parameters, [
      'query' => $query + ['_wrapper_format' => 'island_dialog'],
    ]);
    $attributes = (new Htmx())->get($dialog)
      ->target('#' . CreateActionSourceBase::TARGET_ID)->select('dialog:not(dialog dialog)')->swap('innerHTML')
      ->getAttributes()->toArray();
    return [
      'toggle' => [
        'title' => $entity->isEnabled() ? $this->t('Pause') : $this->t('Resume'),
        'url' => Url::fromRoute('entity.bb_ticket_trigger.toggle_form', $parameters, ['attributes' => $attributes]),
        'weight' => 5,
      ],
    ];
  }

  /**
   * Runs the due triggers; Drupal's cron lock keeps runs from overlapping.
   */
  #[Hook('cron')]
  public function cron(): void {
    $this->runner->runDue();
  }

  /**
   * Deletes the triggers of a deleted target with it.
   */
  #[Hook('entity_delete')]
  public function entityDelete(EntityInterface $entity): void {
    $storage = $this->entityTypeManager->getStorage('bb_ticket_trigger');
    foreach (array_keys($this->targetManager->getDefinitions()) as $bundle) {
      $target = $this->targetManager->createInstance($bundle);
      assert($target instanceof BbTicketTriggerTargetInterface);
      if ($target->targetEntityType() !== $entity->getEntityTypeId()) {
        continue;
      }
      $ids = $storage->getQuery()->accessCheck(FALSE)
        ->condition('bundle', $bundle)
        ->condition($target->targetField(), $entity->id())
        ->execute();
      $storage->delete($storage->loadMultiple($ids));
    }
  }

}
