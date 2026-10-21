<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Form;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\KeyValueStore\KeyValueExpirableFactoryInterface;
use Drupal\Core\KeyValueStore\KeyValueStoreExpirableInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Drupal\island\Form\WrappedDialogFormBase;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Creates a self-service API key and reveals its secret exactly once.
 *
 * Opened as a dialog over the key list (the page-header plus), and still a
 * full page at the same route without JavaScript. Responses are `no-store`
 * (ApiKeyNoStoreSubscriber). The secret exists only in
 * the response to the creating POST: the rebuilt result is never written to
 * the form cache, the session, tempstore, a log or a URL. A session-bound,
 * lock-consumed, expiring nonce posted with the form stops a replayed POST
 * (back navigation, duplicate submit) from creating a second key.
 */
final class ApiKeyCreateForm extends WrappedDialogFormBase {

  /**
   * How long an unconsumed submission nonce stays valid, in seconds.
   */
  private const int NONCE_TTL = 3600;

  /**
   * Creates the key and parses the expiry.
   */
  protected ApiKeyManager $apiKeyManager;

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
    $form->apiKeyManager = $container->get('bb_api_key.manager');
    $form->keyValueExpirableFactory = $container->get('keyvalue.expirable');
    $form->lock = $container->get('lock');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_api_key_create_form';
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
      // The nonce travels with the POST: a fresh one is minted only for a
      // fresh form, so a replayed submission carries a consumed one.
      $posted = $form_state->getUserInput()['nonce'] ?? NULL;
      $nonce = is_string($posted) && $posted !== '' ? $posted : $this->mintNonce();
      $form_state->set('nonce', $nonce);
    }
    $form['nonce'] = ['#type' => 'hidden', '#value' => $nonce];

    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Name'),
      '#description' => $this->t('A name to recognize this key by, e.g. the script or pipeline it authenticates.'),
      '#maxlength' => 255,
      '#required' => TRUE,
      '#picker_region' => 'lines',
    ];
    $form['expires'] = [
      '#type' => 'date',
      '#title' => $this->t('Expires'),
      '#description' => $this->t('UTC date. Choose any day from tomorrow through one year from today; defaults to 90 days out. The key stops working at the start of the following UTC day.'),
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
      $form_state->set('parsed_expires', $this->apiKeyManager->expiryTimestamp((string) $form_state->getValue('expires')));
    }
    catch (\InvalidArgumentException $error) {
      $form_state->setErrorByName('expires', $error->getMessage());
    }
    if (trim((string) $form_state->getValue('label')) === '') {
      $form_state->setErrorByName('label', $this->t('A name is required.'));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $nonce = (string) $form_state->getValue('nonce');
    if (!$this->lock->acquire('bb_api_key_nonce:' . $nonce, 5)) {
      $this->messenger()->addError($this->t('That submission is still being processed. Try again.'));
      $form_state->setRebuild();
      return;
    }

    try {
      $owner = $this->nonceStore()->get($nonce);
      // Consumed before the write: a failure below cannot leave this nonce
      // good for a second attempt.
      $this->nonceStore()->delete($nonce);

      if ($owner === NULL || (int) $owner !== (int) $this->currentUser()->id()) {
        // A replay of an already-used submission: back to the list, no key.
        $this->respondAtReturnUrl($form_state);
        return;
      }

      try {
        $issued = $this->apiKeyManager->create(
          $this->currentUser(),
          (string) $form_state->getValue('label'),
          (int) $form_state->get('parsed_expires'),
        );
      }
      catch (\Throwable $error) {
        $this->logger('bb_api_key')->error('API key creation failed: @class', ['@class' => get_class($error)]);
        $this->messenger()->addError($this->t('The key could not be created. Try again.'));
        $form_state->set('nonce', $this->mintNonce());
        $form_state->setRebuild();
        return;
      }

      $form_state->set('result', [
        'client_id' => (string) $issued['consumer']->get('client_id')->value,
        'secret' => (string) $issued['secret'],
      ]);
      // A POST rebuild is cached by default (FormBuilder::rebuildForm()),
      // which would write the plaintext secret into the form cache.
      $form_state->disableCache();
      $form_state->setRebuild();
    }
    finally {
      $this->lock->release('bb_api_key_nonce:' . $nonce);
    }
  }

  /**
   * {@inheritdoc}
   *
   * The key list when the opener sent no usable destination, e.g. a direct
   * visit to the full-page form.
   */
  protected function returnUrl(): Url {
    $url = parent::returnUrl();
    $user = $this->getRequest()->attributes->get('user');
    if ($url->isRouted() && $url->getRouteName() === '<front>' && $user instanceof UserInterface) {
      return Url::fromRoute('view.bb_api_keys.page', ['user' => $user->id()]);
    }
    return $url;
  }

  /**
   * The one-time credential result, rendered in place of the form fields.
   *
   * In the dialog the whole hull is swapped (HX-Retarget/HX-Reselect), so
   * the footer's Create button is replaced by Done. Done carries
   * `data-dialog-reload`, the opt-in `island.dialog.js` honours to reload the
   * current screen instead of closing in place, so the new key is listed; the
   * close control has no such attribute and simply closes.
   *
   * @param array<string, mixed> $form
   *   The form render array to fill.
   * @param string $client_id
   *   The freshly created key's public client ID.
   * @param string $secret
   *   Its plaintext secret, present only in this response.
   *
   * @return array<string, mixed>
   *   The result form.
   */
  private function buildResult(array $form, string $client_id, string $secret): array {
    if ($this->isDialogRequest()) {
      $form['#attached']['http_header'][] = ['HX-Retarget', '#' . CreateActionSourceBase::TARGET_ID, TRUE];
      $form['#attached']['http_header'][] = ['HX-Reselect', 'dialog:not(dialog dialog)', TRUE];
      $form['#attached']['http_header'][] = ['HX-Reswap', 'innerHTML', TRUE];
    }
    $form['warning'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:note',
      '#props' => ['tone' => 'attention'],
      '#slots' => [
        'body' => (string) $this->t('This secret is shown once. Save it now — it cannot be shown again. If you lose it, revoke this key and create a new one.'),
      ],
      '#picker_region' => 'lines',
    ];
    $form['client_id_label'] = $this->caption((string) $this->t('Client ID'));
    $form['client_id'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:setup_command',
      '#props' => [
        'command' => $client_id,
        'label' => (string) $this->t('Copy the client ID'),
      ],
      '#picker_region' => 'lines',
    ];
    $form['secret_label'] = $this->caption((string) $this->t('Secret'));
    $form['secret'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:setup_command',
      '#props' => [
        'command' => $secret,
        'label' => (string) $this->t('Copy the secret'),
      ],
      '#picker_region' => 'lines',
    ];
    $form['connect'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:setup_paths',
      '#props' => [
        'selected' => 'ai',
        'filter_label' => (string) $this->t('Connect with'),
        'items' => [
          ['label' => (string) $this->t('AI'), 'value' => 'ai'],
          ['label' => (string) $this->t('CLI'), 'value' => 'cli'],
        ],
      ],
      '#slots' => [
        'panel_a' => [
          'caption' => $this->caption((string) $this->t('Paste this into your agent:')),
          'prompt' => [
            '#type' => 'component',
            '#component' => 'bb_theme:setup_command',
            '#props' => [
              'command' => "Connect the bakers.build CLI to this site with client ID {$client_id} using client credentials; the secret is in the environment variable BB_CONSUMER_SECRET.",
              'label' => (string) $this->t('Copy the agent prompt'),
            ],
          ],
        ],
        'panel_b' => [
          'caption' => $this->caption((string) $this->t('Run this command, with the secret in BB_CONSUMER_SECRET:')),
          'command' => [
            '#type' => 'component',
            '#component' => 'bb_theme:setup_command',
            '#props' => [
              'command' => "bakers config init --scope connection --auth-type client_credentials --client-id {$client_id} --secret-env BB_CONSUMER_SECRET",
              'label' => (string) $this->t('Copy the config init command'),
            ],
          ],
        ],
      ],
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
   *
   * @return array<string, mixed>
   *   The caption render array.
   */
  private function caption(string $text): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $text,
        'size' => 'caption',
        'tone' => 'light',
      ],
      '#picker_region' => 'lines',
    ];
  }

  /**
   * Mints and stores a fresh nonce bound to the current account.
   */
  private function mintNonce(): string {
    $nonce = Crypt::randomBytesBase64(32);
    $this->nonceStore()->setWithExpire($nonce, (int) $this->currentUser()->id(), self::NONCE_TTL);
    return $nonce;
  }

  /**
   * The expiring store of valid-but-unconsumed submission nonces.
   */
  private function nonceStore(): KeyValueStoreExpirableInterface {
    return $this->keyValueExpirableFactory->get('bb_api_key_nonce');
  }

}
