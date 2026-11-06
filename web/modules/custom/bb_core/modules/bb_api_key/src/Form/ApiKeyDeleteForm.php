<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\ConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Url;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\bb_core\Form\DeleteDialogFormTrait;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Confirms revocation of a self-service API key.
 *
 * GET never mutates (ConfirmFormBase); the route's `_custom_access` already
 * requires the path user AND the consumer to both belong to the current
 * account, and this form rechecks ownership again at submit so a stale or
 * repeated POST cannot delete a different consumer.
 */
final class ApiKeyDeleteForm extends ConfirmFormBase {

  use DeleteDialogFormTrait;

  public function __construct(
    protected AccountProxyInterface $currentUserProxy,
    protected ApiKeyManager $apiKeyManager,
    protected EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('current_user'),
      $container->get('bb_api_key.manager'),
      $container->get('entity_type.manager'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_api_key_delete_form';
  }

  /**
   * {@inheritdoc}
   */
  public function getQuestion() {
    return $this->t('Revoke this API key?');
  }

  /**
   * {@inheritdoc}
   */
  public function getDescription() {
    return $this->t('Any already-issued access token for this key stops working immediately. This cannot be undone; a replacement pipeline needs a new key.');
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl() {
    $user = $this->getRequest()->attributes->get('user');
    return $user instanceof UserInterface
      ? Url::fromRoute('view.bb_api_keys.page', ['user' => $user->id()])
      : Url::fromRoute('<front>');
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?UserInterface $user = NULL, ?ConsumerInterface $consumer = NULL): array {
    $form = parent::buildForm($form, $form_state);
    $form_state->set('user', $user);
    $form_state->set('consumer', $consumer);
    $this->attachDeleteDialog($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $user = $form_state->get('user');
    $consumer = $form_state->get('consumer');
    if (!$user instanceof UserInterface || !$consumer instanceof ConsumerInterface) {
      $form_state->setRedirect('<front>');
      return;
    }

    // Already-missing records 404 before this point; a repeated submission
    // on a key deleted by a prior request is handled by this reload.
    $storage = $this->entityTypeManager->getStorage('consumer');
    $storage->resetCache([$consumer->id()]);
    $fresh = $storage->load($consumer->id());

    if ($fresh instanceof ConsumerInterface && $this->apiKeyManager->isOwnedBy($fresh, $this->currentUserProxy)) {
      $this->apiKeyManager->revoke($fresh, $this->currentUserProxy);
      $this->messenger()->addStatus($this->t('API key revoked.'));
    }

    $form_state->setRedirect('view.bb_api_keys.page', ['user' => $user->id()]);
  }

}
