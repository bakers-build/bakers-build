<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\ConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Url;
use Drupal\bb_track\Entity\Worklog;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Confirms deletion of a recorded Worklog row.
 */
final class WorklogDeleteForm extends ConfirmFormBase {

  /**
   * Constructs the form.
   *
   * Injected services are protected and not readonly: a POST caches this form,
   * and DependencySerializationTrait restores only those properties.
   *
   * @param \Drupal\Core\Session\AccountProxyInterface $currentUserProxy
   *   The current user.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   */
  public function __construct(
    protected AccountProxyInterface $currentUserProxy,
    protected EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('current_user'),
      $container->get('entity_type.manager'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_worklog_delete_form';
  }

  /**
   * {@inheritdoc}
   */
  public function getQuestion() {
    return $this->t('Delete this time entry?');
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl() {
    $entry = $this->getRequest()->attributes->get('bb_track_worklog');
    return $this->cancelUrl($entry instanceof Worklog ? $entry : NULL);
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(
    array $form,
    FormStateInterface $form_state,
    ?Worklog $bb_track_worklog = NULL,
  ): array {
    $form = parent::buildForm($form, $form_state);
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['#attributes']['autocomplete'] = 'off';
    $form['messages'] = [
      '#type' => 'status_messages',
      '#weight' => -1000,
    ];
    $form_state->set('entry', $bb_track_worklog);
    if ($bb_track_worklog instanceof Worklog) {
      $form['expected_version'] = [
        '#type' => 'hidden',
        '#default_value' => $bb_track_worklog->version(),
      ];
    }
    $form['actions']['cancel']['#url'] = $this->cancelUrl($bb_track_worklog);
    return $form;
  }

  /**
   * Edit permalink that keeps a validated overview destination.
   */
  private function cancelUrl(?Worklog $entry): Url {
    if (!$entry instanceof Worklog) {
      return Url::fromRoute('bb_track.worklog.add');
    }
    $query = [];
    $destination = WorklogOverviewDestination::fromRequest($this->getRequest());
    if ($destination !== NULL) {
      $query['destination'] = $destination;
    }
    return Url::fromRoute('bb_track.worklog.edit', [
      'bb_track_worklog' => $entry->uuid(),
    ], [
      'query' => $query,
    ]);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $entry = $form_state->get('entry');
    if (!$entry instanceof Worklog) {
      return;
    }
    $storage = $this->entityTypeManager->getStorage('bb_track_worklog');
    $storage->resetCache([
      $entry->id(),
    ]);
    $fresh = $storage->load($entry->id());
    $expected = (string) $form_state->getValue('expected_version');
    if (!$fresh instanceof Worklog || $expected === '' || $fresh->version() !== $expected) {
      $this->messenger()->addError($this->t('This entry changed. Reload it before saving.'));
      $form_state->setRedirect('bb_track.worklog.edit', [
        'bb_track_worklog' => $entry->uuid(),
      ]);
      return;
    }
    if (!$fresh->access('delete', $this->currentUserProxy)) {
      $this->messenger()->addError($this->t('You cannot delete this entry.'));
      $form_state->setRedirect('bb_track.worklog.edit', [
        'bb_track_worklog' => $entry->uuid(),
      ]);
      return;
    }
    $fresh->expectedVersion = $expected;
    try {
      $fresh->delete();
    }
    catch (\Throwable $error) {
      $this->logger('bb_track')->error('Time deletion failed: @message', [
        '@message' => $error->getMessage(),
      ]);
      $this->messenger()->addError($this->t('The entry changed or its week is approved. Refresh before trying again.'));
      $form_state->setRebuild();
      return;
    }
    $this->messenger()->addStatus($this->t('Time entry deleted.'));
    $form_state->setRedirect('bb_track.worklog.add');
  }

}
