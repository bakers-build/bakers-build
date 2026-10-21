<?php

declare(strict_types=1);

namespace Drupal\bb_connector\Form;

use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_connector\ConnectorPluginManager;
use Drupal\bb_connector\Entity\BbConnector;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Add/edit form for bb_connector config entities.
 */
final class BbConnectorForm extends EntityForm {

  /**
   * The connector plugin manager.
   */
  private ConnectorPluginManager $pluginManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $instance = parent::create($container);
    $instance->pluginManager = $container->get('plugin.manager.bb_connector');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    /** @var \Drupal\bb_connector\Entity\BbConnectorInterface $connector */
    $connector = $this->entity;

    $plugin_options = [];
    foreach ($this->pluginManager->getDefinitions() as $id => $definition) {
      $plugin_options[$id] = $definition['label'];
    }

    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Label'),
      '#default_value' => $connector->label(),
      '#required' => TRUE,
    ];
    $form['id'] = [
      '#type' => 'machine_name',
      '#default_value' => $connector->id(),
      '#machine_name' => ['exists' => [BbConnector::class, 'load']],
      '#disabled' => !$connector->isNew(),
    ];
    $form['plugin'] = [
      '#type' => 'select',
      '#title' => $this->t('System'),
      '#options' => $plugin_options,
      '#default_value' => $connector->getPluginId(),
      '#required' => TRUE,
    ];
    $form['import_interval'] = [
      '#type' => 'number',
      '#title' => $this->t('Cron import interval (seconds)'),
      '#description' => $this->t('0 disables periodic import.'),
      '#default_value' => $connector->getImportInterval(),
      '#min' => 0,
    ];
    $form['settings'] = ['#type' => 'details', '#title' => $this->t('Connection'), '#open' => TRUE, '#tree' => TRUE];
    $form['settings']['base_url'] = [
      '#type' => 'url',
      '#title' => $this->t('Base URL'),
      '#default_value' => $connector->getSetting('base_url'),
      '#required' => TRUE,
    ];
    $form['settings']['token'] = [
      '#type' => 'textfield',
      '#title' => $this->t('API token'),
      '#default_value' => $connector->getSetting('token'),
      '#description' => $this->t("Leave empty and override via settings.php: <code>\$config['bb_connector.connector.ID']['settings']['token'] = getenv('…');</code>"),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $result = $this->entity->save();
    $this->messenger()->addStatus($this->t('Connector %label saved.', ['%label' => $this->entity->label()]));
    $form_state->setRedirectUrl($this->entity->toUrl('collection'));
    return $result;
  }

}
