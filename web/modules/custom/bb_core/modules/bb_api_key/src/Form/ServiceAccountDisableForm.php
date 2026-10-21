<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Form;

use Drupal\Core\Form\ConfirmFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Url;
use Drupal\bb_api_key\ServiceAccountCleanupException;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\TicketNavigation;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Confirms the terminal Disable action for a service account.
 *
 * GET never mutates. `ServiceAccountManager::disable()` is idempotent: a
 * retry after a failed cleanup is safe and finishes the remaining work
 * rather than erroring on an already-blocked account.
 */
final class ServiceAccountDisableForm extends ConfirmFormBase {

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
    return 'bb_service_account_disable_form';
  }

  /**
   * {@inheritdoc}
   */
  public function getQuestion() {
    return $this->t('Disable this service account?');
  }

  /**
   * {@inheritdoc}
   */
  public function getDescription() {
    return $this->t('All of its keys and active tokens are revoked and it can no longer authenticate. This cannot be undone; tickets it already created keep it as their author.');
  }

  /**
   * {@inheritdoc}
   */
  public function getConfirmText() {
    return $this->t('Disable');
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
  public function buildForm(array $form, FormStateInterface $form_state, ?UserInterface $user = NULL): array {
    $form = parent::buildForm($form, $form_state);
    $form_state->set('user', $user);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $user = $form_state->get('user');
    if ($user instanceof UserInterface) {
      try {
        $this->serviceAccountManager->disable($user, $this->currentUserProxy);
        $this->messenger()->addStatus($this->t('Service account disabled.'));
      }
      catch (ServiceAccountCleanupException $error) {
        $this->messenger()->addError($this->t('The account is blocked, but cleanup did not fully complete. Try Disable again.'));
      }
      catch (\RuntimeException | \InvalidArgumentException $error) {
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
