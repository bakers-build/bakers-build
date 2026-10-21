<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Routing\BbConductorRouteProvider;
use Drupal\island\Form\WrappedDialogFormTrait;

/**
 * Confirms Disable conductor or Enable conductor.
 *
 * Opened from the Overview's Properties footer, as a dialog with JavaScript
 * and as a plain page without it. The page writes nothing; only the confirm
 * submit does, after re-reading the conductor. The posted action names the
 * target value and the value it was rendered from, so a stale or repeated
 * confirm never toggles back. Deactivation consequences (reassignment, no
 * claims) stay with the existing save hooks.
 */
final class BbConductorActionForm extends EntityForm {

  use WrappedDialogFormTrait;

  /**
   * The current conductor.
   *
   * @var \Drupal\bb_core\Entity\BbConductorInterface
   */
  protected $entity;

  /**
   * Whether the account in context may switch the conductor's activity.
   */
  public static function mayChangeActivity(BbConductorInterface $conductor): bool {
    return $conductor->access('update') && $conductor->get('active')->access('edit');
  }

  /**
   * The confirmation, as a dialog or as a plain page.
   */
  public static function confirmationUrl(BbConductorInterface $conductor, bool $dialog): Url {
    $query = ['destination' => $conductor->toUrl()->toString()];
    if ($dialog) {
      $query['_wrapper_format'] = 'island_dialog';
    }
    return Url::fromRoute('entity.bb_conductor.action_form', $conductor->toUrl()->getRouteParameters(), ['query' => $query]);
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $conductor = $this->entity;
    $form['#cache']['max-age'] = 0;
    $this->attachDialogHtmx($form);

    $active = (bool) $conductor->get('active')->value;
    $available = self::mayChangeActivity($conductor);
    $question = match (TRUE) {
      !$available => $this->t('This action is no longer available. The conductor shows its current state.'),
      $active => $this->t('@conductor stops receiving new assignments and claims no work. Its eligible pending tickets are reassigned or cleared. Work already in flight is not cancelled.', ['@conductor' => $this->name()]),
      default => $this->t('@conductor can be assigned and claim work again. Tickets moved away while it was disabled stay where they are, and no process is started.', ['@conductor' => $this->name()]),
    };
    $form['question'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:message',
      '#props' => ['status' => $available ? 'warning' : 'status'],
      '#slots' => ['body' => ['#plain_text' => (string) $question]],
      '#weight' => -10,
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['keep'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'label' => (string) ($active ? $this->t('Keep enabled') : $this->t('Keep disabled')),
        'href' => $conductor->toUrl()->toString(),
        'variant' => 'ghost',
      ],
      '#weight' => 0,
    ];
    if (!$available) {
      return $form;
    }
    // A submit rendered from the other value is stale and writes nothing.
    $form['bb_from_active'] = ['#type' => 'hidden', '#value' => $active ? '1' : '0'];
    $form['actions']['bb_confirm'] = [
      '#type' => 'submit',
      '#name' => 'bb_confirm',
      '#value' => $active ? $this->t('Disable conductor') : $this->t('Enable conductor'),
      '#bb_active' => !$active,
      '#bb_variant' => $active ? 'danger' : 'primary',
      '#theme_wrappers' => ['input__submit__bb_button'],
      '#limit_validation_errors' => [],
      '#submit' => ['::submitActivity'],
      '#weight' => 10,
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    // Only the confirm handler writes, and only the active flag.
  }

  /**
   * Sets the confirmed activity on a freshly loaded conductor.
   *
   * Form API submit handler; the form array is part of its signature.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function submitActivity(array &$form, FormStateInterface $form_state): void {
    $target = $this->postedTarget($form_state);
    $conductor = $this->entityTypeManager->getStorage('bb_conductor')->loadUnchanged($this->entity->id());
    if ($target === NULL || !$conductor instanceof BbConductorInterface
      || (bool) $conductor->get('active')->value === $target || !self::mayChangeActivity($conductor)) {
      $this->messenger()->addError($this->t('This action is no longer available. The conductor shows its current state.'));
      $this->respondAtReturnUrl($form_state);
      return;
    }
    $conductor->set('active', $target);
    // As ContentEntityForm does: only the written field and the entity
    // itself are judged, not stored references the account cannot select.
    $violations = $conductor->validate();
    $violations->filterByFields(array_diff(array_keys($conductor->getFieldDefinitions()), ['active']));
    if (count($violations) > 0) {
      $this->messenger()->addError($this->t('The conductor could not be saved. It shows its last saved state.'));
      $this->respondAtReturnUrl($form_state);
      return;
    }
    $conductor->save();
    $this->entity = $conductor;
    $this->messenger()->addStatus($target
      ? $this->t('@conductor is enabled.', ['@conductor' => $this->name()])
      : $this->t('@conductor is disabled.', ['@conductor' => $this->name()]));
    $this->respondAtReturnUrl($form_state);
  }

  /**
   * The posted target value, only when its own button was really posted.
   *
   * Drupal falls back to the form's first button when the posted one no
   * longer exists, so the button's name has to be in the input, and it has
   * to be posted from the value it was rendered in.
   */
  private function postedTarget(FormStateInterface $form_state): ?bool {
    $trigger = $form_state->getTriggeringElement();
    $input = $form_state->getUserInput();
    if (!isset($trigger['#bb_active'], $trigger['#name']) || !array_key_exists($trigger['#name'], $input)) {
      return NULL;
    }
    $target = (bool) $trigger['#bb_active'];
    return ($input['bb_from_active'] ?? NULL) === ($target ? '0' : '1') ? $target : NULL;
  }

  /**
   * The conductor's visible name, falling back to its registration id.
   */
  private function name(): string {
    return BbConductorRouteProvider::title($this->entity);
  }

}
