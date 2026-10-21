<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Access\TicketAccountAccess;
use Drupal\bb_track\Form\TicketAccountForm;
use Drupal\bb_track\WorkAssignments;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The ticket inspector's Billing row.
 *
 * Every ticket viewer reads the applying account and its origin; a project
 * editor gets the picker instead. Reading needs no recording permission.
 */
#[Source(
  id: 'bb_track_ticket_billing',
  label: new TranslatableMarkup('[bakers.build] Ticket billing account'),
  description: new TranslatableMarkup('The billing account a ticket books to, editable by project editors.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', label: new TranslatableMarkup('Ticket'), required: TRUE),
  ],
)]
final class TicketBillingSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * The billing-account application service.
   */
  protected WorkAssignments $assignments;

  /**
   * The form builder.
   */
  protected FormBuilderInterface $formBuilder;

  /**
   * The entity type manager.
   */
  protected EntityTypeManagerInterface $entityTypes;

  /**
   * The viewer.
   */
  protected AccountInterface $viewer;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->assignments = $container->get('bb_track.assignments');
    $instance->formBuilder = $container->get('form_builder');
    $instance->entityTypes = $container->get('entity_type.manager');
    $instance->viewer = $container->get('current_user');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $ticket = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew() || !$ticket->get('project_id')->entity) {
      return [];
    }
    // The picker exactly when its route would accept the post.
    $access = TicketAccountAccess::link($ticket, $this->viewer);
    try {
      $build = $access->isAllowed()
        ? $this->formBuilder->getForm(TicketAccountForm::class, $ticket)
        : TicketAccountForm::row($ticket, $this->assignments, $this->entityTypes->getStorage('bb_ticket'));
    }
    catch (\DomainException) {
      // An inconsistent ancestry (a cycle) resolves nothing; show no row.
      $build = [];
    }
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($ticket)
      ->addCacheableDependency($access)
      ->addCacheTags(['bb_track_account_list', 'bb_ticket_list'])
      ->applyTo($build);
    return $build;
  }

}
