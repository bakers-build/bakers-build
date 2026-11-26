<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Form;

use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\BbContentEntityFormBase;
use Drupal\bb_core\Form\HtmxTransport;
use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
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
   * The secret is shown once, right after the first save.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $new = $this->entity->isNew();
    $result = parent::save($form, $form_state);
    $webhook = $this->entity;
    assert($webhook instanceof BbWebhookInterface);
    if ($new) {
      $this->messenger()->addWarning($this->t('Signing secret: %secret. Copy it now; it is not shown again.', ['%secret' => $webhook->getSecret()]));
    }
    if ($this->isDialogRequest() || $this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      $this->respondAtReturnUrl($form_state);
    }
    return $result;
  }

}
