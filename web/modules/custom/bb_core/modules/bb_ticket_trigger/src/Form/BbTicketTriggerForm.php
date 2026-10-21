<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Form;

use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Render\Element;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\island\Form\WrappedDialogFormTrait;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Adds or edits a trigger as a page inside its template.
 *
 * The type's own configuration form comes from the Plugin module's
 * plugin-selector widget. The service-account select offers only the active
 * service accounts of the template's workspace; the entity constraints still
 * decide, so the form adds no rule of its own. Opened from the Triggers
 * tab's Add action it answers in the overlay; edit links open it as a page.
 */
final class BbTicketTriggerForm extends ContentEntityForm {

  use WrappedDialogFormTrait {
    create as createWithDialog;
  }

  /**
   * Resolves the template's workspace.
   */
  private WorkspaceResolverInterface $workspaceResolver;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = static::createWithDialog($container);
    $form->workspaceResolver = $container->get(WorkspaceResolverInterface::class);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getEntityFromRouteMatch(RouteMatchInterface $route_match, $entity_type_id) {
    $template = $route_match->getParameter('bb_ticket_template');
    if ($route_match->getRawParameter($entity_type_id) === NULL && $template instanceof BbTicketTemplateInterface) {
      // A new trigger of the `template` target, anchored where its template is.
      return $this->entityTypeManager->getStorage($entity_type_id)->create([
        'bundle' => 'template',
        'template_id' => $template->id(),
        'workspace_id' => $this->workspaceResolver->resolve($template)?->id(),
      ]);
    }
    return parent::getEntityFromRouteMatch($route_match, $entity_type_id);
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The form.
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if (isset($form['actor_uid']['widget'])) {
      $form['actor_uid']['widget']['#options'] = ['_none' => $this->t('- None -')] + $this->serviceAccountOptions();
    }
    unset($form['created'], $form['changed']);
    if (!$this->isDialogRequest()) {
      // A page round trip: a boosted submit would swap the response instead
      // of reloading it, and the shell places no messages region.
      $form['#attributes']['data-hx-boost'] = 'false';
      $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    }
    $this->attachDialogHtmx($form);
    $form['#after_build'][] = '::attachTypeRefresh';
    return $form;
  }

  /**
   * Refreshes the type's settings over htmx when its frequency changes.
   *
   * The settings are built inside the plugin widget, so the marked frequency
   * field is found after the build. Only the settings section is swapped.
   *
   * @param array $form
   *   The built form; ungenerified for `Htmx::applyTo()`.
   *
   * @return array
   *   The form.
   */
  public function attachTypeRefresh(array $form): array {
    $frequency = &self::markedElement($form, 'data-trigger-frequency');
    if ($frequency === NULL) {
      return $form;
    }
    // A select triggers no submit handlers; the posted name makes it the
    // triggering element, so the form rebuilds without validation errors.
    $htmx = (new Htmx())
      ->post($this->isDialogRequest() ? $this->dialogPostUrl() : Url::fromUserInput($this->getRequest()->getPathInfo()))
      ->trigger('change')
      ->vals(['_triggering_element_name' => $frequency['#name']])
      ->select('[data-trigger-schedule]')
      ->target('[data-trigger-schedule]')
      ->swap('outerHTML');
    if (!$this->isDialogRequest()) {
      $htmx->onlyMainContent();
    }
    $htmx->applyTo($frequency);
    return $form;
  }

  /**
   * The first element below $element carrying the attribute $marker.
   *
   * @param array $element
   *   The element to search.
   * @param string $marker
   *   The attribute name.
   *
   * @return array|null
   *   A reference to the element, or NULL.
   */
  private static function &markedElement(array &$element, string $marker): ?array {
    $none = NULL;
    foreach (Element::children($element) as $key) {
      if (!empty($element[$key]['#attributes'][$marker])) {
        return $element[$key];
      }
      $found = &self::markedElement($element[$key], $marker);
      if ($found !== NULL) {
        return $found;
      }
    }
    return $none;
  }

  /**
   * {@inheritdoc}
   *
   * Opened over a screen, the form carries a Cancel link back to it: the
   * dialog's close control and Escape follow that link and do nothing
   * without it.
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The actions.
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
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $result = parent::save($form, $form_state);
    $this->messenger()->addStatus($this->t('The trigger has been saved.'));
    if ($this->isDialogRequest() || $this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      $this->respondAtReturnUrl($form_state);
      $this->getRequest()->query->remove(static::RETURN_PARAMETER);
      return $result;
    }
    $url = $this->listUrl();
    if ($url !== NULL) {
      $form_state->setRedirectUrl($url);
    }
    return $result;
  }

  /**
   * The template's Triggers tab.
   */
  private function listUrl(): ?Url {
    $trigger = $this->getEntity();
    return $trigger instanceof BbTicketTriggerInterface ? $trigger->getTargetPlugin()->listUrl($trigger) : NULL;
  }

  /**
   * Active service accounts of the template's workspace, by name.
   *
   * @return array<int, string>
   *   User ID => account name.
   */
  private function serviceAccountOptions(): array {
    $trigger = $this->getEntity();
    $workspace = $trigger instanceof BbTicketTriggerInterface ? $trigger->getWorkspace() : NULL;
    if ($workspace === NULL) {
      return [];
    }
    $storage = $this->entityTypeManager->getStorage('user');
    // The form is gated on template `update`; the accounts are the
    // workspace's own, listed to its administrator.
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('bb_service_workspace', $workspace->id())
      ->condition('status', 1)
      ->sort('name')
      ->execute();
    $options = [];
    foreach ($storage->loadMultiple($ids) as $account) {
      $options[(int) $account->id()] = (string) $account->getDisplayName();
    }
    return $options;
  }

}
