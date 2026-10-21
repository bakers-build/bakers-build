<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Form;

use Drupal\Core\Form\ConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Url;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\TicketNavigation;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Confirms revocation of one service account's key.
 *
 * GET never mutates; the route's `_custom_access` already requires the
 * workspace, the target user AND the consumer to compose correctly
 * (ServiceAccountAccess::manageKey), and `revokeKey()` rechecks ownership
 * again at submit.
 */
final class ServiceAccountKeyRevokeForm extends ConfirmFormBase {

  public function __construct(
    protected AccountProxyInterface $currentUserProxy,
    protected ServiceAccountManager $serviceAccountManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('current_user'),
      $container->get(ServiceAccountManager::class),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_service_account_key_revoke_form';
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
    return $this->t('Any already-issued access token for this key stops working immediately. This cannot be undone.');
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl() {
    return $this->listUrl();
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?UserInterface $user = NULL, ?ConsumerInterface $consumer = NULL): array {
    $form = parent::buildForm($form, $form_state);
    $form_state->set('user', $user);
    $form_state->set('consumer', $consumer);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $user = $form_state->get('user');
    $consumer = $form_state->get('consumer');
    if ($user instanceof UserInterface && $consumer instanceof ConsumerInterface) {
      try {
        $this->serviceAccountManager->revokeKey($user, $consumer, $this->currentUserProxy);
        $this->messenger()->addStatus($this->t('API key revoked.'));
      }
      catch (\InvalidArgumentException $error) {
        $this->messenger()->addError($error->getMessage());
      }
    }
    // Core drops redirects on htmx submits; the boosted shell posts this form.
    TicketNavigation::finishAt($this->listUrl(), $form_state, $this->getRequest());
  }

  /**
   * Back to the Service Accounts list for this route's workspace.
   */
  private function listUrl(): Url {
    $workspace = $this->getRequest()->attributes->get('bb_workspace');
    return $workspace instanceof BbWorkspaceInterface
      ? Url::fromRoute('view.bb_service_accounts.settings', ['bb_workspace' => $workspace->getSlug()])
      : Url::fromRoute('<front>');
  }

}
