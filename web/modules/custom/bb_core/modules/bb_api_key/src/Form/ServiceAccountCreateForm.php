<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Form;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\KeyValueStore\KeyValueExpirableFactoryInterface;
use Drupal\Core\KeyValueStore\KeyValueStoreExpirableInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\island\Form\WrappedDialogFormBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Creates a workspace service account and reveals its first key once.
 *
 * Same one-time-reveal/no-store/replay contract as ApiKeyCreateForm, with
 * three extra choices the personal form has no need of: the service
 * account's workspace role (Guest/Contributor), its team, and its team role
 * (Member/Reporter). `ServiceAccountManager::create()` re-validates every
 * choice and performs the atomic write; this form only shapes the input and
 * the one-time result.
 */
final class ServiceAccountCreateForm extends WrappedDialogFormBase {

  /**
   * How long an unconsumed submission nonce stays valid, in seconds.
   */
  private const int NONCE_TTL = 3600;

  /**
   * Performs the atomic create and the first key issuance.
   */
  protected ServiceAccountManager $serviceAccountManager;

  /**
   * Supplies the default expiry and parses the posted date.
   */
  protected ApiKeyManager $apiKeyManager;

  /**
   * Loads the workspace's teams.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * The workspace administrator creating the account.
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
    $form->entityTypeManager = $container->get('entity_type.manager');
    $form->currentUserProxy = $container->get('current_user');
    $form->keyValueExpirableFactory = $container->get('keyvalue.expirable');
    $form->lock = $container->get('lock');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_service_account_create_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $workspace = $this->workspace();
    $form['#cache']['max-age'] = 0;
    $form['#theme'] = 'bb_create_dialog';

    $result = $form_state->get('result');
    if (is_array($result) && is_string($result['client_id'] ?? NULL) && is_string($result['secret'] ?? NULL) && is_string($result['name'] ?? NULL)) {
      $form = $this->buildResult($form, $result['name'], $result['client_id'], $result['secret']);
      $this->attachDialogHtmx($form);
      return $form;
    }

    $teams = $this->teamOptions($workspace);
    if ($teams === []) {
      $form['no_team'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:note',
        '#props' => ['tone' => 'attention'],
        '#slots' => [
          'body' => (string) $this->t('This workspace has no team yet. Create a team and associate the intended project with it before creating a service account.'),
        ],
        '#picker_region' => 'lines',
      ];
      $form['actions'] = [
        '#type' => 'actions',
        'close' => [
          '#type' => 'component',
          '#component' => 'bb_theme:button',
          '#props' => [
            'variant' => 'ghost',
            'label' => (string) $this->t('Close'),
            'href' => $this->returnUrl()->toString(),
            'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
          ],
        ],
      ];
      $this->attachDialogHtmx($form);
      return $form;
    }

    $nonce = $form_state->get('nonce');
    if (!is_string($nonce)) {
      // Bound to the operation AND the target workspace, so a nonce minted
      // for one workspace's create form cannot be replayed against another.
      $posted = $form_state->getUserInput()['nonce'] ?? NULL;
      $nonce = is_string($posted) && $posted !== '' ? $posted : $this->mintNonce($workspace);
      $form_state->set('nonce', $nonce);
    }
    $form['nonce'] = ['#type' => 'hidden', '#value' => $nonce];

    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Name'),
      '#description' => $this->t('A name for this automation, e.g. the pipeline it authenticates. The stored account name is generated from it.'),
      '#maxlength' => 255,
      '#required' => TRUE,
      '#picker_region' => 'lines',
    ];
    $form['workspace_role'] = [
      '#type' => 'select',
      '#title' => $this->t('Workspace role'),
      '#options' => [
        'guest' => $this->t('Guest'),
        'contributor' => $this->t('Contributor'),
      ],
      '#default_value' => 'guest',
      '#description' => $this->t('Guest reads the projects of its team. Contributor also works on tickets and can register/claim with Conductor, in its team scope.'),
      '#picker_region' => 'lines',
    ];
    $form['team_id'] = [
      '#type' => 'select',
      '#title' => $this->t('Team'),
      '#options' => $teams,
      '#default_value' => (string) array_key_first($teams),
      '#description' => $this->t('Grants access to the projects associated with this team.'),
      '#required' => TRUE,
      '#picker_region' => 'lines',
    ];
    $form['team_role'] = [
      '#type' => 'select',
      '#title' => $this->t('Team role'),
      '#options' => [
        'reporter' => $this->t('Reporter — can create tickets in this team'),
        'member' => $this->t('Member — read only'),
      ],
      '#default_value' => 'reporter',
      '#picker_region' => 'lines',
    ];
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
        '#value' => $this->t('Create service account'),
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
    if (is_array($form_state->get('result')) || !isset($form['label'])) {
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
    if (!is_numeric($form_state->getValue('team_id'))) {
      $form_state->setErrorByName('team_id', $this->t('Choose a team.'));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $workspace = $this->workspace();
    $nonce = (string) $form_state->getValue('nonce');
    if (!$this->lock->acquire('bb_service_account_nonce:' . $nonce, 5)) {
      $this->messenger()->addError($this->t('That submission is still being processed. Try again.'));
      $form_state->setRebuild();
      return;
    }

    try {
      $owner = $this->nonceStore()->get($nonce);
      $this->nonceStore()->delete($nonce);

      if (!is_array($owner) || (int) ($owner['uid'] ?? 0) !== (int) $this->currentUserProxy->id() || (int) ($owner['workspace'] ?? 0) !== (int) $workspace->id()) {
        $this->respondAtReturnUrl($form_state);
        return;
      }

      $team = $this->entityTypeManager->getStorage('bb_team')->load((int) $form_state->getValue('team_id'));
      if (!$team instanceof BbTeamInterface || (int) $team->get('workspace_id')->target_id !== (int) $workspace->id()) {
        $this->messenger()->addError($this->t('Choose a team in this workspace.'));
        $form_state->set('nonce', $this->mintNonce($workspace));
        $form_state->setRebuild();
        return;
      }

      try {
        $issued = $this->serviceAccountManager->create(
          $workspace,
          $team,
          (string) $form_state->getValue('label'),
          (string) $form_state->getValue('workspace_role'),
          (string) $form_state->getValue('team_role'),
          (string) $form_state->getValue('expires'),
          $this->currentUserProxy,
          (string) $form_state->getValue('key_label'),
        );
      }
      catch (\Throwable $error) {
        $this->logger('bb_api_key')->error('Service account creation failed: @class', ['@class' => get_class($error)]);
        $this->messenger()->addError($this->t('The service account could not be created. @reason', ['@reason' => $error instanceof \InvalidArgumentException ? $error->getMessage() : '']));
        $form_state->set('nonce', $this->mintNonce($workspace));
        $form_state->setRebuild();
        return;
      }

      $form_state->set('result', [
        'name' => $issued['user']->getAccountName(),
        'client_id' => (string) $issued['consumer']->get('client_id')->value,
        'secret' => (string) $issued['secret'],
      ]);
      $form_state->disableCache();
      $form_state->setRebuild();
    }
    finally {
      $this->lock->release('bb_service_account_nonce:' . $nonce);
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
  private function buildResult(array $form, string $name, string $client_id, string $secret): array {
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
        'body' => $this->t('This secret is shown once. Save it now — it cannot be shown again. The account name is %name; if you lose the secret, create a new key for it from this list.', ['%name' => $name]),
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
    $form['ci_hint'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => (string) $this->t('Store the secret as a masked/protected CI variable, e.g. BB_CONSUMER_SECRET. Keep the client ID separately; it is not secret.'),
        'size' => 'caption',
        'tone' => 'light',
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
   * The route's workspace, which the acting account must administer.
   */
  private function workspace(): BbWorkspaceInterface {
    $workspace = $this->getRouteMatch()->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface || !$workspace->access('update', $this->currentUserProxy)) {
      throw new AccessDeniedHttpException();
    }
    return $workspace;
  }

  /**
   * The workspace's teams by label, in name order; empty blocks creation.
   *
   * @return array<int|string, string>
   *   Team labels keyed by id.
   */
  private function teamOptions(BbWorkspaceInterface $workspace): array {
    $storage = $this->entityTypeManager->getStorage('bb_team');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('workspace_id', $workspace->id())
      ->sort('name')
      ->execute();
    $options = [];
    foreach ($storage->loadMultiple($ids) as $team) {
      $options[$team->id()] = (string) $team->label();
    }
    return $options;
  }

  /**
   * Mints and stores a fresh nonce bound to the actor and this workspace.
   */
  private function mintNonce(BbWorkspaceInterface $workspace): string {
    $nonce = Crypt::randomBytesBase64(32);
    $this->nonceStore()->setWithExpire($nonce, [
      'uid' => (int) $this->currentUserProxy->id(),
      'workspace' => (int) $workspace->id(),
    ], self::NONCE_TTL);
    return $nonce;
  }

  /**
   * The expiring store of valid-but-unconsumed submission nonces.
   */
  private function nonceStore(): KeyValueStoreExpirableInterface {
    return $this->keyValueExpirableFactory->get('bb_service_account_nonce');
  }

}
