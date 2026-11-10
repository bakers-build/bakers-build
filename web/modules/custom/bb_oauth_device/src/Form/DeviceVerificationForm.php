<?php

declare(strict_types=1);

namespace Drupal\bb_oauth_device\Form;

use Drupal\Core\Flood\FloodInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\consumers\Entity\Consumer;
use Drupal\bb_oauth_device\Repositories\DeviceCodeRepository;
use Drupal\simple_oauth\Entities\ClientEntityInterface;
use Drupal\simple_oauth\Server\AuthorizationServerFactoryInterface;
use League\OAuth2\Server\Entities\DeviceCodeEntityInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Lets a signed-in human confirm or deny a waiting device sign-in.
 */
class DeviceVerificationForm extends FormBase {

  /**
   * Flood-control event name and window.
   *
   * RFC 8628 §5.2 requires throttling the user-code endpoint against
   * guessing.
   */
  protected const FLOOD_EVENT = 'bb_oauth_device.verify';
  protected const FLOOD_LIMIT = 10;
  protected const FLOOD_WINDOW_SECONDS = 300;

  public function __construct(
    protected DeviceCodeRepository $deviceCodeRepository,
    protected AuthorizationServerFactoryInterface $authorizationServerFactory,
    protected AccountInterface $currentUser,
    protected FloodInterface $flood,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = new static(
      $container->get('bb_oauth_device.repositories.device_code'),
      $container->get('simple_oauth.server.authorization_server.factory'),
      $container->get('current_user'),
      $container->get('flood'),
    );
    $form->setRequestStack($container->get('request_stack'));

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_oauth_device_verify';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    // After a decision, submitForm() redirects back here with `?done=`
    // instead of re-showing the code field and Confirm/Deny buttons — a
    // human who already clicked Confirm should see a done state, not the
    // same form again with a status message floating above it.
    $done = $this->getRequest()->query->get('done');
    if ($done === 'confirmed' || $done === 'denied') {
      $form['result'] = $this->buildDoneResult($done === 'confirmed');
      return $form;
    }

    // Prefilling from the query string is what makes the RFC's
    // verification_uri_complete worth sending.
    $prefill = $this->getRequest()->query->get('user_code', '');
    $prefill = is_string($prefill) ? $prefill : '';
    // The page's one h1: the gate chrome carries the mark, not a heading.
    $form['heading'] = $this->text($this->t('Sign in a device'), [
      'as' => 'h1',
      'size' => 'section-title',
      'align' => 'center',
    ]) + ['#weight' => -20];
    $form += $this->buildCodeField($prefill);

    // Resolving the code already on GET, before any decision is made, is what
    // gives the human something to consent to rather than a blind text field
    // (the consumer's name and the token's scopes). The lookup is an
    // existence oracle, so it is gated by the POST path's flood control.
    if ($prefill !== '' && $this->floodAllows()) {
      $device_code = $this->deviceCodeRepository->getDeviceCodeEntityByUserCode($this->normalize($prefill));
      if ($device_code === NULL) {
        $this->flood->register(self::FLOOD_EVENT, self::FLOOD_WINDOW_SECONDS, $this->floodIdentifier());
      }
      if ($device_code !== NULL && $device_code->getUserIdentifier() === NULL) {
        $client = $this->drupalConsumer($device_code);
        $form['consent'] = $this->text($this->t('@client wants to sign in', ['@client' => $client->label()]));
        $scopes = array_map(static fn ($scope) => $scope->getIdentifier(), $device_code->getScopes());
        $form['consent_scopes'] = $this->text($scopes
          ? $this->t('Requested access: @scopes', ['@scopes' => implode(', ', $scopes)])
          : $this->t('No specific access scopes were requested.'), ['tone' => 'faint']);
      }
    }

    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['confirm'] = [
      '#type' => 'submit',
      '#value' => $this->t('Confirm sign-in'),
      '#name' => 'confirm',
    ];
    $form['actions']['deny'] = [
      '#type' => 'submit',
      '#value' => $this->t('Deny'),
      '#name' => 'deny',
    ];

    return $form;
  }

  /**
   * The post-decision render array: a welcome or a denial notice.
   */
  protected function buildDoneResult(bool $confirmed): array {
    $content = [
      'title' => $this->text($confirmed
        ? $this->t('Welcome, @name', ['@name' => $this->currentUser->getDisplayName()])
        : $this->t('Sign-in denied'), ['as' => 'h1', 'size' => 'page-title']),
      'body' => $this->text($confirmed
        ? $this->t('You are signed in. You can return to your terminal.')
        : $this->t('You can return to your terminal.'), ['size' => 'prose', 'tone' => 'default']),
    ];
    if ($confirmed) {
      $content['home'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'label' => $this->t('Go to bakers.build'),
          'href' => Url::fromRoute('bb_core.home')->toString(),
        ],
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'align' => 'center'],
      '#slots' => ['content' => $content],
    ];
  }

  /**
   * A run of copy rendered by the theme's text component.
   *
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $text
   *   The copy.
   * @param array<string, string> $props
   *   Further text component props (element, size, tone).
   *
   * @return array<string, mixed>
   *   A text component render array.
   */
  protected function text(TranslatableMarkup $text, array $props = []): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => ['text' => $text] + $props,
    ];
  }

  /**
   * The device-code field: prefilled and non-editable, or blank and typed.
   *
   * Prefilled means decided by the terminal that printed it, not typed by
   * the human confirming it: shown as text, not an editable/readonly input,
   * and carried through as a hidden field so validateForm() still reads it
   * from the POST.
   */
  protected function buildCodeField(string $prefill): array {
    if ($prefill === '') {
      return [
        'user_code' => [
          '#type' => 'textfield',
          '#title' => $this->t('Device code'),
          '#description' => $this->t('Enter the code shown in your terminal.'),
          '#required' => TRUE,
          '#maxlength' => 32,
        ],
      ];
    }
    return [
      'user_code_display' => [
        '#type' => 'item',
        '#title' => $this->t('Device code'),
        'code' => [
          '#type' => 'component',
          '#component' => 'bb_theme:text',
          '#props' => [
            'text' => $this->normalize($prefill),
            'as' => 'span',
            'size' => 'section-title',
            'tracking' => 'widest',
          ],
        ],
      ],
      'user_code' => [
        '#type' => 'hidden',
        '#value' => $prefill,
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    if (!$this->floodAllows()) {
      $this->logger('bb_oauth_device')->notice('Device code attempts blocked for account %uid.', ['%uid' => $this->currentUser->id()]);
      $form_state->setErrorByName('user_code', $this->t('Too many attempts. Wait a few minutes and try again.'));
      return;
    }

    $device_code = $this->deviceCodeRepository
      ->getDeviceCodeEntityByUserCode($this->normalize($form_state->getValue('user_code')));

    // A code already decided is refused with the same generic message as an
    // unknown one: no second submitter may reverse a deny or re-bind a
    // confirm before the CLI's next poll.
    if ($device_code === NULL || $device_code->getUserIdentifier() !== NULL) {
      $this->flood->register(self::FLOOD_EVENT, self::FLOOD_WINDOW_SECONDS, $this->floodIdentifier());
      $form_state->setErrorByName('user_code', $this->t('That code is not valid. It may have expired — start the sign-in again in your terminal.'));
      return;
    }

    $form_state->set('device_code', $device_code);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    /** @var \League\OAuth2\Server\Entities\DeviceCodeEntityInterface $device_code */
    $device_code = $form_state->get('device_code');
    $approved = $form_state->getTriggeringElement()['#name'] === 'confirm';

    $client = $this->drupalConsumer($device_code);
    $server = $this->authorizationServerFactory->get($client);

    try {
      $server->completeDeviceAuthorizationRequest(
        $device_code->getIdentifier(),
        (string) $this->currentUser->id(),
        $approved
      );
    }
    catch (OAuthServerException $exception) {
      $this->messenger()->addError($this->t('The sign-in could not be completed: @reason', [
        '@reason' => $exception->getMessage(),
      ]));
      return;
    }

    // Redirect to the done state rather than a messenger status above a
    // re-shown code field and Confirm/Deny buttons — the decision is final
    // (validateForm() above refuses a code that already carries one), so the
    // page a human lands on should say so, not offer the same form again.
    $form_state->setRedirect('bb_oauth_device.verify', [], [
      'query' => ['done' => $approved ? 'confirmed' : 'denied'],
    ]);
  }

  /**
   * Whether the current account may still attempt a code lookup or decision.
   *
   * Keyed on the authenticated account, not the request IP: the route
   * requires sign-in already, and `reverse_proxy = TRUE` with no configured
   * `reverse_proxy_addresses` makes every request's client IP resolve to the
   * proxy, which would collapse the whole site behind one shared bucket.
   */
  protected function floodAllows(): bool {
    return $this->flood->isAllowed(self::FLOOD_EVENT, self::FLOOD_LIMIT, self::FLOOD_WINDOW_SECONDS, $this->floodIdentifier());
  }

  /**
   * The flood-control identifier: the signed-in account.
   */
  protected function floodIdentifier(): string {
    return 'uid:' . $this->currentUser->id();
  }

  /**
   * Accepts the code the way a human retypes it, separators and all.
   *
   * The parameter is `mixed` because validateForm() hands over a submitted
   * value it has not typed. A `user_code[]=X` POST does not in fact reach
   * here as an array — Drupal's element value handling neutralises it first,
   * and the form answers "Device code field is required." — so this is
   * defence in depth at a trust boundary rather than a fix for a reachable
   * TypeError, and there is deliberately no test asserting a path that the
   * form pipeline does not expose.
   */
  protected function normalize(mixed $userCode): string {
    if (!is_string($userCode)) {
      return '';
    }
    return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $userCode) ?? '');
  }

  /**
   * The Drupal consumer entity backing a device code's client.
   */
  protected function drupalConsumer(DeviceCodeEntityInterface $device_code): Consumer {
    $client_entity = $device_code->getClient();
    if (!$client_entity instanceof ClientEntityInterface) {
      throw new \RuntimeException('Device code client is not a Drupal-backed consumer.');
    }

    return $client_entity->getDrupalEntity();
  }

}
