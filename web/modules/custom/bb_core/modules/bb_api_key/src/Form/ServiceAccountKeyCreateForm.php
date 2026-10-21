<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Form;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\KeyValueStore\KeyValueExpirableFactoryInterface;
use Drupal\Core\KeyValueStore\KeyValueStoreExpirableInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\island\Form\WrappedDialogFormBase;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Issues an additional key for an existing, active service account.
 *
 * Opened from the Service Accounts listing (rotation: create the new key
 * here first, update CI variables, then revoke the old one from the same
 * row). Same one-time-reveal/no-store/replay contract as the create form.
 */
final class ServiceAccountKeyCreateForm extends WrappedDialogFormBase {

  /**
   * How long an unconsumed submission nonce stays valid, in seconds.
   */
  private const int NONCE_TTL = 3600;

  /**
   * Issues the key and parses the expiry.
   */
  protected ServiceAccountManager $serviceAccountManager;

  /**
   * Supplies the default expiry and parses the posted date.
   */
  protected ApiKeyManager $apiKeyManager;

  /**
   * The actor requesting the new key.
   */
  protected AccountProxyInterface $currentUserProxy;

  /**
   * Holds valid-but-unconsumed submission nonces.
   */
  protected KeyValueExpirableFactoryInterface $keyValueExpirableFactory;

  /**
   * Serializes the consumption of one nonce.
   */
  protected LockBackendInterface $lock;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->serviceAccountManager = $container->get(ServiceAccountManager::class);
    $form->apiKeyManager = $container->get('bb_api_key.manager');
    $form->currentUserProxy = $container->get('current_user');
    $form->keyValueExpirableFactory = $container->get('keyvalue.expirable');
    $form->lock = $container->get('lock');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_service_account_key_create_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?UserInterface $user = NULL): array {
    $form['#cache']['max-age'] = 0;
    $form['#theme'] = 'bb_create_dialog';
    $form_state->set('user', $user);

    $result = $form_state->get('result');
    if (is_array($result) && is_string($result['client_id'] ?? NULL) && is_string($result['secret'] ?? NULL)) {
      $form = $this->buildResult($form, $result['client_id'], $result['secret']);
      $this->attachDialogHtmx($form);
      return $form;
    }

    $nonce = $form_state->get('nonce');
    if (!is_string($nonce)) {
      $posted = $form_state->getUserInput()['nonce'] ?? NULL;
      $nonce = is_string($posted) && $posted !== '' ? $posted : $this->mintNonce((int) $user?->id());
      $form_state->set('nonce', $nonce);
    }
    $form['nonce'] = ['#type' => 'hidden', '#value' => $nonce];

    $form['key_label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Key name'),
      '#description' => $this->t('Shown in the key list, e.g. the pipeline or CI variable that uses this key.'),
      '#maxlength' => 255,
      '#required' => TRUE,
      '#picker_region' => 'lines',
    ];
    $form['expires'] = [
      '#type' => 'date',
      '#title' => $this->t('Expires'),
      '#description' => $this->t('UTC date. Choose any day from tomorrow through one year from today; defaults to 90 days out.'),
      '#default_value' => $this->apiKeyManager->defaultExpiryDate(),
      '#required' => TRUE,
      '#picker_region' => 'lines',
    ];
    $form['actions'] = [
      '#type' => 'actions',
      'cancel' => [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'variant' => 'ghost',
          'label' => (string) $this->t('Cancel'),
          'href' => $this->returnUrl()->toString(),
          'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
        ],
        '#weight' => -10,
      ],
      'submit' => [
        '#type' => 'submit',
        '#value' => $this->t('Create API key'),
        '#theme_wrappers' => ['input__submit__bb_button'],
      ],
    ];
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    if (is_array($form_state->get('result'))) {
      return;
    }
    try {
      $this->apiKeyManager->expiryTimestamp((string) $form_state->getValue('expires'));
    }
    catch (\InvalidArgumentException $error) {
      $form_state->setErrorByName('expires', $error->getMessage());
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    /** @var \Drupal\user\UserInterface $user */
    $user = $form_state->get('user');
    $nonce = (string) $form_state->getValue('nonce');
    if (!$this->lock->acquire('bb_service_account_key_nonce:' . $nonce, 5)) {
      $this->messenger()->addError($this->t('That submission is still being processed. Try again.'));
      $form_state->setRebuild();
      return;
    }

    try {
      $owner = $this->nonceStore()->get($nonce);
      $this->nonceStore()->delete($nonce);
      if (!is_array($owner) || (int) ($owner['uid'] ?? 0) !== (int) $this->currentUserProxy->id() || (int) ($owner['user'] ?? 0) !== (int) $user->id()) {
        $this->respondAtReturnUrl($form_state);
        return;
      }

      try {
        $issued = $this->serviceAccountManager->issueKey($user, (string) $form_state->getValue('expires'), $this->currentUserProxy, (string) $form_state->getValue('key_label'));
      }
      catch (\Throwable $error) {
        $this->logger('bb_api_key')->error('Service-account key issuance failed: @class', ['@class' => get_class($error)]);
        $this->messenger()->addError($this->t('The key could not be created. Try again.'));
        $form_state->set('nonce', $this->mintNonce((int) $user->id()));
        $form_state->setRebuild();
        return;
      }

      $form_state->set('result', [
        'client_id' => (string) $issued['consumer']->get('client_id')->value,
        'secret' => (string) $issued['secret'],
      ]);
      $form_state->disableCache();
      $form_state->setRebuild();
    }
    finally {
      $this->lock->release('bb_service_account_key_nonce:' . $nonce);
    }
  }

  /**
   * {@inheritdoc}
   */
  protected function returnUrl(): Url {
    $url = parent::returnUrl();
    $workspace = $this->getRequest()->attributes->get('bb_workspace');
    if ($url->isRouted() && $url->getRouteName() === '<front>' && $workspace instanceof BbWorkspaceInterface) {
      return Url::fromRoute('view.bb_service_accounts.settings', ['bb_workspace' => $workspace->getSlug()]);
    }
    return $url;
  }

  /**
   * The one-time credential result, in the same shape as ApiKeyCreateForm's.
   *
   * @return array<string, mixed>
   *   The result form.
   */
  private function buildResult(array $form, string $client_id, string $secret): array {
    if ($this->isDialogRequest()) {
      $form['#attached']['http_header'][] = ['HX-Retarget', '#bakers-overlay', TRUE];
      $form['#attached']['http_header'][] = ['HX-Reselect', 'dialog:not(dialog dialog)', TRUE];
      $form['#attached']['http_header'][] = ['HX-Reswap', 'innerHTML', TRUE];
    }
    $form['warning'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:note',
      '#props' => ['tone' => 'attention'],
      '#slots' => [
        'body' => (string) $this->t('This secret is shown once. Save it now, update the CI variable, verify the new key works, then revoke the old one from the list.'),
      ],
      '#picker_region' => 'lines',
    ];
    $form['client_id_label'] = $this->caption((string) $this->t('Client ID'));
    $form['client_id'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:setup_command',
      '#props' => ['command' => $client_id, 'label' => (string) $this->t('Copy the client ID')],
      '#picker_region' => 'lines',
    ];
    $form['secret_label'] = $this->caption((string) $this->t('Secret'));
    $form['secret'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:setup_command',
      '#props' => ['command' => $secret, 'label' => (string) $this->t('Copy the secret')],
      '#picker_region' => 'lines',
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

  /**
   * A short caption line above a copy item.
   */
  private function caption(string $text): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => ['text' => $text, 'size' => 'caption', 'tone' => 'light'],
      '#picker_region' => 'lines',
    ];
  }

  /**
   * Mints and stores a fresh nonce bound to the actor and the target user.
   */
  private function mintNonce(int $uid): string {
    $nonce = Crypt::randomBytesBase64(32);
    $this->nonceStore()->setWithExpire($nonce, ['uid' => (int) $this->currentUserProxy->id(), 'user' => $uid], self::NONCE_TTL);
    return $nonce;
  }

  /**
   * The expiring store of valid-but-unconsumed submission nonces.
   */
  private function nonceStore(): KeyValueStoreExpirableInterface {
    return $this->keyValueExpirableFactory->get('bb_service_account_key_nonce');
  }

}
