<?php

declare(strict_types=1);

namespace Drupal\bb_oauth_device\Form;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Flood\FloodInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\consumers\Entity\Consumer;
use Drupal\bb_oauth_device\Repositories\DeviceCodeRepository;
use Drupal\og\MembershipManagerInterface;
use Drupal\og\OgRoleInterface;
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
    // Optional: this module does not depend on og.
    protected ?MembershipManagerInterface $membershipManager,
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
      $container->get('og.membership_manager', ContainerInterface::NULL_ON_INVALID_REFERENCE),
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

    // The link's code (RFC 8628 verification_uri_complete) looks up the
    // consent below and, once it resolves to a waiting device, fills the field
    // for comparison with the terminal: the human still sees and submits the
    // code, and validateForm() binds the decision to the described device.
    $linkCode = $this->getRequest()->query->get('user_code', '');
    $linkCode = is_string($linkCode) ? $linkCode : '';
    // The page's one h1: the gate chrome carries the mark, not a heading.
    $form['heading'] = $this->text($this->t('Sign in a device'), [
      'as' => 'h1',
      'size' => 'page-title',
    ]) + ['#weight' => -20];
    $form['user_code'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Device code'),
      '#description' => $this->t('Type the code shown in your own terminal.'),
      '#required' => TRUE,
      '#maxlength' => 32,
      // Orders the core fallback; bb_theme's presenter template places it.
      '#weight' => 10,
    ];

    if ($linkCode !== '' && !$this->floodAllows()) {
      // The code may well be valid; calling it invalid would send the human
      // back to the terminal for nothing.
      $this->linkNotice($form, $this->t('Too many attempts. Wait a few minutes and try again.'));
    }
    elseif ($linkCode !== '') {
      $this->buildConsent($form, $linkCode);
    }

    $form['actions'] = ['#type' => 'actions', '#weight' => 20];
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
   * Adds the waiting device's consent and fills in its code.
   *
   * Resolving the code already on GET, before any decision is made, is what
   * gives the human something to consent to rather than a blind text field
   * (the consumer's name and the token's scopes). The lookup is an
   * existence oracle, so it is gated by the POST path's flood control.
   *
   * @param array<string, mixed> $form
   *   The verification form.
   * @param string $linkCode
   *   The code the opened link carries.
   */
  protected function buildConsent(array &$form, string $linkCode): void {
    $device_code = $this->deviceCodeRepository->getDeviceCodeEntityByUserCode($this->normalize($linkCode));
    if ($device_code === NULL) {
      $this->flood->register(self::FLOOD_EVENT, self::FLOOD_WINDOW_SECONDS, $this->floodIdentifier());
    }
    if ($device_code === NULL || $device_code->getUserIdentifier() !== NULL) {
      // Expired, decided or unknown: say so instead of a bare field.
      $this->linkNotice($form, $this->t('That code is not valid. It may have expired — start the sign-in again in your terminal.'));
      return;
    }
    $client = $this->drupalConsumer($device_code);
    $site = (string) $this->config('system.site')->get('name');
    $form['consent'] = $this->text($this->t('@client wants to sign in to @site (@host) as @account.', [
      '@client' => $client->label(),
      '@site' => $site,
      '@host' => $this->getRequest()->getHost(),
      '@account' => $this->currentUser->getDisplayName(),
    ]));
    $memberships = $this->membershipBlocks();
    $form['consent_access'] = $this->text($memberships
      ? $this->t('If you confirm, the device can do everything you can do on @site, in your workspaces and teams, with your roles there.', ['@site' => $site])
      : $this->t("You aren't in any workspace yet, so the device can't reach any workspace content."));
    // Closed by default: the lines lengthen the centred decision frame.
    $lines = [];
    foreach ($memberships as $block) {
      // One paragraph per line keeps each line escaped once; the gapless
      // zone keeps a workspace's lines together, its teams smaller below.
      $head = array_shift($block);
      $team = ['size' => 'meta', 'tone' => 'light'];
      $lines[] = [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'none', 'gap' => 'none'],
        '#slots' => [
          'content' => [
            $this->text($head),
            ...array_map(fn (TranslatableMarkup $line): array => $this->text($line, $team), $block),
          ],
        ],
      ];
    }
    if ($memberships) {
      $lines[] = $this->text($this->t('What do these roles mean?'), [
        'href' => 'https://bakers.build/docs/provision/security/access-and-data#roles-and-permissions',
      ]);
      $form['consent_memberships'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:collapsible',
        '#slots' => [
          'label' => $this->text($this->t('Your workspaces and roles'), [
            'as' => 'span',
            'size' => 'meta',
            'tone' => 'faint',
          ]),
          'content' => [
            '#type' => 'component',
            '#component' => 'bb_theme:zone',
            '#props' => ['inset' => 'none', 'gap' => 'sm'],
            '#slots' => ['content' => $lines],
          ],
        ],
      ];
    }
    $scopes = array_map(static fn ($scope) => $scope->getIdentifier(), $device_code->getScopes());
    $form['consent_scopes'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:collapsible',
      '#slots' => [
        'label' => $this->text($this->t('Technical details'), ['as' => 'span', 'size' => 'meta', 'tone' => 'faint']),
        'content' => $this->text($scopes
          ? $this->t('Requested scopes: @scopes', ['@scopes' => implode(', ', $scopes)])
          : $this->t('No specific access scopes were requested.'), ['size' => 'meta', 'tone' => 'faint']),
      ],
    ];
    $form['consent_revoke'] = $this->text(
      $this->t("You can't sign this device out yourself yet. Ask a site administrator to revoke it."),
      ['size' => 'meta', 'tone' => 'faint'],
    );
    $form['user_code']['#default_value'] = $linkCode;
    $form['user_code']['#description'] = $this->t('Compare with the code in your terminal.');
  }

  /**
   * Says why an opened link shows no consent, in the consent's place.
   *
   * Only on GET: a submitted form already carries the same words as the
   * code field's error.
   *
   * @param array<string, mixed> $form
   *   The verification form.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $notice
   *   The reason, translated.
   */
  protected function linkNotice(array &$form, TranslatableMarkup $notice): void {
    if ($this->getRequest()->isMethod('GET')) {
      $form['consent'] = $this->text($notice);
    }
  }

  /**
   * The account's memberships, one block per workspace with its teams below.
   *
   * A token reaches what the account's ranks reach in these groups, so they,
   * not site-wide permissions, say what a confirmation grants. A workspace
   * the account only reaches through a team still heads it, without a rank.
   *
   * @return \Drupal\Core\StringTranslation\TranslatableMarkup[][]
   *   Blocks of lines such as ["Workspace keytec — Admin", "Team North —
   *   Member"], sorted by workspace, each group once.
   */
  protected function membershipBlocks(): array {
    $workspaces = [];
    foreach ($this->membershipManager?->getMemberships((int) $this->currentUser->id()) ?? [] as $membership) {
      $group = $membership->getGroup();
      if (!$group instanceof FieldableEntityInterface) {
        continue;
      }
      $roles = $membership->getRoles();
      // Every membership holds the required member role; name it only alone.
      $ranks = array_filter($roles, static fn (OgRoleInterface $role): bool => $role->getRoleType() !== OgRoleInterface::ROLE_TYPE_REQUIRED) ?: $roles;
      $args = [
        '@group' => $group->label(),
        '@roles' => implode(', ', array_map(static fn (OgRoleInterface $role): string => (string) $role->label(), $ranks)),
      ];
      // shortcut: a group with `workspace_id` is a team, any other a
      // workspace; og.settings registers only these two, extend on a third.
      $is_team = $group->hasField('workspace_id');
      $workspace = $is_team ? $group->get('workspace_id')->entity : NULL;
      if (!$workspace instanceof EntityInterface) {
        // A team whose workspace is gone stays a team, at the top level.
        $workspaces[$this->sortKey($group)]['head'] = $is_team
          ? $this->t('Team @group — @roles', $args)
          : $this->t('Workspace @group — @roles', $args);
        continue;
      }
      $key = $this->sortKey($workspace);
      $workspaces[$key]['head'] ??= $this->t('Workspace @group', ['@group' => $workspace->label()]);
      $workspaces[$key]['teams'][$this->sortKey($group)] = $this->t('Team @group — @roles', $args);
    }
    ksort($workspaces, SORT_NATURAL | SORT_FLAG_CASE);
    return array_values(array_map(static function (array $workspace): array {
      $teams = $workspace['teams'] ?? [];
      ksort($teams, SORT_NATURAL | SORT_FLAG_CASE);
      return [$workspace['head'], ...array_values($teams)];
    }, $workspaces));
  }

  /**
   * Orders groups by label; type and id keep equally named groups apart.
   */
  protected function sortKey(EntityInterface $group): string {
    return $group->label() . "\0" . $group->getEntityTypeId() . "\0" . $group->id();
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
        ? $this->t('The device is now signed in as you. It can act in your workspaces with your roles until it is signed out. Return to your terminal.')
        : $this->t('The device was not signed in and got no access. You can close this page.'),
        ['size' => 'prose', 'tone' => 'default']),
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
   *   The copy, translated.
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
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    if (!$this->floodAllows()) {
      $this->logger('bb_oauth_device')->notice('Device code attempts blocked for account %uid.', ['%uid' => $this->currentUser->id()]);
      $form_state->setErrorByName('user_code', $this->t('Too many attempts. Wait a few minutes and try again.'));
      return;
    }

    $typed = $this->normalize($form_state->getValue('user_code'));
    $device_code = $this->deviceCodeRepository->getDeviceCodeEntityByUserCode($typed);
    // A page that described the link's device may decide only that one.
    $linkCode = $this->normalize($this->getRequest()->query->get('user_code', ''));

    // A code already decided is refused with the same generic message as an
    // unknown one: no second submitter may reverse a deny or re-bind a
    // confirm before the CLI's next poll.
    if ($device_code === NULL || $device_code->getUserIdentifier() !== NULL || ($linkCode !== '' && $linkCode !== $typed)) {
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
