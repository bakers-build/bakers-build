<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Form\BbConductorActionForm;
use Drupal\bb_core\Form\BbContentEntityFormBase;
use Drupal\bb_core\Form\BbRestartRunsForm;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The conductor Properties footer: Disable or Enable, Restart runs, Delete.
 */
#[Source(
  id: 'bb_conductor_actions',
  label: new TranslatableMarkup('[bakers.build] Conductor actions'),
  description: new TranslatableMarkup('Disable or enable a conductor, behind a confirmation.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_conductor', label: new TranslatableMarkup('Conductor'), required: TRUE),
  ],
)]
final class BbConductorActionsSource extends SourcePluginBase {

  /**
   * The current-session account proxy, injected in `create()`.
   */
  protected AccountProxyInterface $currentUser;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->currentUser = $container->get('current_user');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $conductor = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$conductor instanceof BbConductorInterface) {
      return [];
    }
    $build = [];
    if (BbConductorActionForm::mayChangeActivity($conductor)) {
      $active = (bool) $conductor->get('active')->value;
      // The create-trigger contract: the overlay is the target, and only the
      // answer's `dialog` element is swapped in.
      $attributes = (new Htmx())->get(BbConductorActionForm::confirmationUrl($conductor, TRUE))
        ->target('#bakers-overlay')->select('dialog')->swap('innerHTML')->getAttributes();
      $build['activity'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        // The dialog's own libraries arrive too late for the first click.
        '#attached' => ['library' => ['core/drupal.htmx']],
        '#props' => [
          'label' => (string) ($active ? $this->t('Disable conductor') : $this->t('Enable conductor')),
          'href' => BbConductorActionForm::confirmationUrl($conductor, FALSE)->toString(),
          'variant' => $active ? 'danger' : 'neutral',
          'attributes' => $attributes,
        ],
      ];
    }
    if (TicketInterventions::mayRestartRuns($conductor, $this->currentUser)) {
      $build['restart'] = BbRestartRunsForm::button($conductor);
    }
    $build += BbContentEntityFormBase::deleteAction($conductor);
    CacheableMetadata::createFromObject($conductor)
      ->addCacheContexts(['user', 'url.path'])
      ->addCacheTags(['og_membership_list'])
      ->applyTo($build);
    return $build;
  }

}
