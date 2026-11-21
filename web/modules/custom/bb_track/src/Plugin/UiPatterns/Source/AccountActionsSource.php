<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\UiPatterns\Source;

use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Form\AccountActionsForm;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The billing account detail's footer: Edit, Make default, Archive.
 */
#[Source(
  id: 'bb_track_account_actions',
  label: new TranslatableMarkup('[bakers.build] Billing account actions'),
  description: new TranslatableMarkup('Edit, make default or archive a billing account.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_track_account', label: new TranslatableMarkup('Billing account'), required: TRUE),
  ],
)]
final class AccountActionsSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * The form builder.
   */
  protected FormBuilderInterface $formBuilder;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->formBuilder = $container->get('form_builder');
    return $instance;
  }

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
    // The form is uncacheable: it answers its own POST on this page.
    return $billing_account instanceof Account
      ? $this->formBuilder->getForm(AccountActionsForm::class, $billing_account)
      : [];
  }

}
