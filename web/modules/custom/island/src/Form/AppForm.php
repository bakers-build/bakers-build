<?php

declare(strict_types=1);

namespace Drupal\island\Form;

use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

/**
 * Add/edit form for island apps.
 */
final class AppForm extends EntityForm {

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    /** @var \Drupal\island\Entity\AppInterface $app */
    $app = $this->entity;
    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Label'),
      '#default_value' => $app->label(),
      '#required' => TRUE,
    ];
    $form['id'] = [
      '#type' => 'machine_name',
      '#default_value' => $app->id(),
      '#machine_name' => ['exists' => [App::class, 'load']],
      '#disabled' => !$app->isNew(),
    ];
    $form['provider'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Provider'),
      '#default_value' => $app->getProviderId(),
      '#required' => TRUE,
      '#description' => $this->t('The application provider service identifier.'),
    ];
    $form['page_application'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Use this app for page layouts'),
      '#default_value' => $app->id() !== NULL && $this->config('island.settings')->get('page_app') === $app->id(),
      '#description' => $this->t('Select profiles from this app for normal pages. Pages with no applicable profile keep their normal layout.'),
    ];
    $profiles = [];
    foreach (IslandProfile::loadMultiple() as $profile) {
      if ($profile->getAppId() === $app->id()) {
        $profiles[$profile->id()] = $profile->label();
      }
    }
    $form['default_profile'] = [
      '#type' => 'select',
      '#title' => $this->t('Default profile'),
      '#options' => $profiles,
      '#empty_option' => $this->t('- No default profile -'),
      '#default_value' => $app->getDefaultProfileId(),
      '#description' => $this->t('Used when no conditional profile applies.'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $result = $this->entity->save();
    $settings = $this->configFactory()->getEditable('island.settings');
    if ($form_state->getValue('page_application')) {
      $settings->set('page_app', $this->entity->id())->save();
    }
    elseif ($settings->get('page_app') === $this->entity->id()) {
      $settings->set('page_app', '')->save();
    }
    $this->messenger()->addStatus($this->t('App %label has been saved.', ['%label' => $this->entity->label()]));
    $form_state->setRedirectUrl($this->entity->toUrl('collection'));
    return $result;
  }

}
