<?php

declare(strict_types=1);

namespace Drupal\bb_login\Hook;

use Drupal\Component\Render\PlainTextOutput;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Utility\Token;
use Drupal\bb_login\EmailLogin;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * The bakers.build auth experience: passwordless login by e-mail.
 *
 * `mail()` sends the pending sign-up's own mail, which `_user_mail_notify()`
 * cannot without an account. `mailAlter()` and the `[bakers:*]` tokens put the
 * code, the claim URL and the one-hop login link into the generated mails.
 * Landing after login belongs to `BbOneTimeLoginController`, not here.
 */
final class BbLoginMailHooks {

  use StringTranslationTrait;

  public function __construct(
    #[Autowire(service: 'config.factory')]
    private readonly ConfigFactoryInterface $configFactory,
    #[Autowire(service: 'token')]
    private readonly Token $token,
    #[Autowire(service: 'bb_login.email_login')]
    private readonly EmailLogin $emailLogin,
  ) {}

  /**
   * Implements hook_mail().
   *
   * THE OPERATOR'S TEMPLATE, SENT WITHOUT AN ACCOUNT. A pending sign-up has
   * no user entity, so `_user_mail_notify()` cannot send it — but the text
   * should not fork. This loads the same
   * `user.mail.register_no_approval_required` the settings form edits and
   * replaces its tokens directly.
   *
   * NO `user` DATA AND NO `user_mail_tokens` CALLBACK, deliberately: that
   * callback computes `user_pass_reset_url()` unconditionally whenever a
   * user is present, which on an unsaved account reaches
   * `user_pass_rehash()` with a NULL password. `clear => TRUE` deletes any
   * `[user:*]` token an operator leaves in the body rather than rendering a
   * broken one.
   *
   * @param string $key
   *   The mail key. Only `pending_signup` is handled here.
   * @param array<string, mixed> $message
   *   The message array to build.
   * @param array<string, mixed> $params
   *   Unused: the mail carries no per-send parameters.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('mail')]
  public function mail(string $key, array &$message, array $params): void {
    if ($key !== 'pending_signup') {
      return;
    }
    $config = $this->configFactory->get('user.mail');
    $options = ['langcode' => $message['langcode'], 'clear' => TRUE];
    $message['subject'] .= PlainTextOutput::renderFromHtml(
      $this->token->replace((string) $config->get('register_no_approval_required.subject'), [], $options)
    );
    $message['body'][] = $this->token->replacePlain(
      (string) $config->get('register_no_approval_required.body'), [], $options
    );
  }

  /**
   * Implements hook_mail_alter().
   *
   * Appends the pending destination to the one-time login link, so a deep
   * link survives the mail even when it is opened on a DIFFERENT device
   * than the one that asked for it. The session copy `BbLoginForm` parks
   * covers the ordinary same-browser case; this covers the phone.
   *
   * String surgery is the only seam: core expands `[user:one-time-login-url]`
   * before our code runs, and owning the token would mean owning the one-time
   * mechanism. Appending `/login` targets `user.reset.login` directly; that
   * is safe because the mailed code survives a prefetched link. Only core's
   * `password_reset` mail is touched.
   *.
   *
   * @param array<string, mixed> $message
   *   The message array to alter.
   */
  #[Hook('mail_alter')]
  public function mailAlter(array &$message): void {
    if ($message['module'] !== 'user') {
      return;
    }
    if ($message['key'] !== 'password_reset') {
      return;
    }
    $destination = $this->emailLogin->pendingDestination();

    // ONE HOP, NOT TWO. `[user:one-time-login-url]` expands to `user.reset`,
    // which redirects to a confirmation screen; appending `/login` addresses
    // `user.reset.login` directly, so the link signs the customer in on the
    // first click. That is only safe to do because the code below exists: a
    // prefetched link spends the token, and the code is what rescues the
    // customer when it does.
    //
    // The destination rides on the SAME request that establishes the
    // session, so core's `RedirectResponseSubscriber` applies and validates
    // it with no help from us.
    $suffix = '/login' . ($destination === '' ? '' : '?destination=' . rawurlencode($destination));
    foreach ($message['body'] as $index => $part) {
      $part = (string) $part;
      // Anchored on the reset path and stopping at whitespace, so only the
      // link is touched and a body that merely mentions the path is not.
      $part = preg_replace('#(/user/reset/\d+/\d+/[^\s?]+)#', '$1' . $suffix, $part);
      $message['body'][$index] = $part;
    }
  }

  /**
   * Implements hook_token_info().
   *
   * These must be real tokens: core replaces mail tokens with
   * `'clear' => TRUE` (`user/src/Hook/UserHooks.php:235`), deleting any
   * placeholder a later `hook_mail_alter()` would have substituted.
   *
   * @return array<string, mixed>
   *   The token type and token definitions.
   */
  #[Hook('token_info')]
  public function tokenInfo(): array {
    return [
      'types' => [
        'bakers' => [
          'name' => $this->t('bakers.build'),
          'description' => $this->t('Tokens this product adds to its own mails.'),
        ],
      ],
      'tokens' => [
        'bakers' => [
          'login-code' => [
            'name' => $this->t('Login code'),
            'description' => $this->t('The six-digit code that signs the recipient in, valid for 15 minutes.'),
          ],
          'login-url' => [
            'name' => $this->t('Login URL'),
            'description' => $this->t('The claim URL a pending sign-up is mailed instead of an account link.'),
          ],
        ],
      ],
    ];
  }

  /**
   * Implements hook_tokens().
   *
   * READ FROM THE SERVICE THAT JUST ISSUED IT, not generated here: the code
   * has to be the same one stored for verification, and issuing a second
   * one at render time would mail a code that no longer matches the store.
   * Same reasoning for `login-url`.
   *
   * @param string $type
   *   The machine-readable name of the type of token being replaced.
   * @param array<int, string> $tokens
   *   An array of tokens to be replaced, keyed by the literal text.
   * @param array<string, mixed> $data
   *   Unused: neither token needs contextual data.
   * @param array<string, mixed> $options
   *   Unused: neither token needs options.
   *
   * @return array<string, string>
   *   The replacement values, keyed by the original placeholder.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('tokens')]
  public function tokens(string $type, array $tokens, array $data, array $options): array {
    $replacements = [];
    if ($type !== 'bakers') {
      return $replacements;
    }
    foreach ($tokens as $name => $original) {
      if ($name === 'login-code') {
        $replacements[$original] = $this->emailLogin->pendingCode();
      }
      if ($name === 'login-url') {
        $replacements[$original] = $this->emailLogin->pendingLoginUrl();
      }
    }
    return $replacements;
  }

}
