<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Form;

use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\BbContentEntityFormBase;
use Drupal\bb_core\Form\HtmxTransport;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSource;
use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Template\Attribute;
use Drupal\island\Form\WrappedDialogFormTrait;

/**
 * Webhook add/edit form; the scope comes from the add route, never a field.
 *
 * Opened from the tab's Create webhook action it answers in the shell dialog
 * and lands back on the tab, as the environment form does.
 */
final class BbWebhookForm extends BbContentEntityFormBase {

  use WrappedDialogFormTrait;

  /**
   * {@inheritdoc}
   */
  public function getEntityFromRouteMatch(RouteMatchInterface $route_match, $entity_type_id) {
    $entity = parent::getEntityFromRouteMatch($route_match, $entity_type_id);
    assert($entity instanceof BbWebhookInterface);
    if (!$entity->isNew()) {
      return $entity;
    }
    $workspace = $route_match->getParameter('bb_workspace');
    if ($workspace instanceof BbWorkspaceInterface) {
      $entity->set('workspace_id', $workspace->id());
    }
    $project = $route_match->getParameter('bb_project');
    if ($project instanceof BbProjectInterface) {
      $entity->set('project_id', $project->id());
    }
    $group = $route_match->getParameter('bb_group');
    if ($group instanceof BbGroupInterface) {
      $entity->set('group_id', $group->id());
    }
    return $entity;
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if (!$this->isDialogRequest()) {
      // A boosted page submit is an htmx request, for which core drops the
      // redirect: the save would land nowhere and show no message.
      $form['#attributes']['data-hx-boost'] = 'false';
      $form['#action'] = HtmxTransport::currentUrl($this->getRequest())->toString();
      $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    }
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * Opened over a screen, Cancel returns there without saving; the dialog's
   * close control closes towards the same target.
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    if ($this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      $actions['cancel'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'variant' => 'ghost',
          'label' => (string) $this->t('Cancel'),
          'href' => $this->returnUrl()->toString(),
          'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
        ],
        '#weight' => -10,
      ];
    }
    return $actions;
  }

  /**
   * {@inheritdoc}
   *
   * After the first save the form is rebuilt into the one-time secret.
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $secret = $form_state->get('secret');
    if (!is_string($secret)) {
      return parent::buildForm($form, $form_state);
    }
    $form = $this->buildResult($form, $secret);
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * The secret is shown once, right after the first save, as an API key's is.
   * A new webhook skips the parent's in-place landing: its response would win
   * over the rebuild into the secret. An edit lands as the parent's does.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $webhook = $this->entity;
    assert($webhook instanceof BbWebhookInterface);
    if (!$webhook->isNew()) {
      return parent::save($form, $form_state);
    }
    $result = $webhook->save();
    $this->addSavedMessage();
    // Only in this response: a rebuild is cached by default, and a message
    // would keep the secret in the session.
    $form_state->set('secret', $webhook->getSecret());
    $form_state->disableCache();
    $form_state->setRebuild();
    return $result;
  }

  /**
   * The one-time secret, rendered in place of the form fields.
   *
   * The same shape as an API key's (ApiKeyCreateForm::buildResult()): in the
   * dialog the whole hull is swapped, so Save becomes Done, which reloads the
   * list.
   *
   * @param array<string, mixed> $form
   *   The form render array to fill.
   * @param string $secret
   *   The signing secret, present only in this response.
   *
   * @return array<string, mixed>
   *   The result form.
   */
  private function buildResult(array $form, string $secret): array {
    $form['#cache']['max-age'] = 0;
    if ($this->isDialogRequest()) {
      $form['#attached']['http_header'][] = ['HX-Retarget', '#' . CreateActionSource::TARGET_ID, TRUE];
      $form['#attached']['http_header'][] = ['HX-Reselect', 'dialog:not(dialog dialog)', TRUE];
      $form['#attached']['http_header'][] = ['HX-Reswap', 'innerHTML', TRUE];
    }
    $form['warning'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:note',
      '#props' => ['tone' => 'attention'],
      '#slots' => [
        'body' => (string) $this->t('This signing secret is shown once. Save it now — it cannot be shown again. If you lose it, delete this webhook and create a new one.'),
      ],
    ];
    $form['secret'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:setup_command',
      '#props' => [
        'command' => $secret,
        'label' => (string) $this->t('Copy the secret'),
      ],
    ];
    $form['actions'] = [
      '#type' => 'actions',
      'done' => [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'variant' => 'primary',
          'label' => (string) $this->t('Done'),
          'href' => $this->returnUrl()->toString(),
          'attributes' => new Attribute([
            'data-dialog-cancel' => 'data-dialog-cancel',
            'data-dialog-reload' => 'data-dialog-reload',
          ]),
        ],
      ],
    ];
    return $form;
  }

}
