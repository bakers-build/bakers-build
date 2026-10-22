<?php

declare(strict_types=1);

namespace Drupal\bb_login;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Mail\MailManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\user\UserInterface;
use Psr\Log\LoggerInterface;

/**
 * Turns an e-mail address into a mailed one-time login link.
 *
 * Known and unknown addresses are indistinguishable to the caller, so no
 * form can become a membership oracle. A known account gets core's one-time
 * login link; an unknown address gets a pending sign-up claim URL. Flood
 * control belongs to `BbLoginForm`.
 *.
 */
final class EmailLogin {

  /**
   * The mail template an existing account's link travels in.
   *
   * Named `password_reset` by core; its text is rewritten to describe what it
   * is here: a login link. The name stays core's
   * because the TOKEN is core's; renaming the template would mean owning the
   * mechanism.
   */
  private const MAIL_KNOWN_ACCOUNT = 'password_reset';

  /**
   * The fallback username stem when an address yields no usable name.
   */
  private const NAME_FALLBACK = 'bakers';

  /**
   * Where the mail being generated should land, or an empty string.
   */
  private string $pendingDestination = '';

  /**
   * The code the mail being generated should carry, or an empty string.
   *
   * Read back by `BbLoginMailHooks::mailAlter()`, which is the only seam
   * Drupal offers for touching a generated body — `_user_mail_notify()` is
   * core's and takes no extra arguments.
   */
  private string $pendingCode = '';

  /**
   * The claim URL the mail being generated should carry, or an empty string.
   *
   * Set only on the deferred branch, which mails a nonce of our own
   * rather than core's `[user:one-time-login-url]` — there is no account yet
   * to derive that token from. Read back by `[bakers:login-url]`.
   */
  private string $pendingLoginUrl = '';

  /**
   * The code the mail currently being built should carry.
   *
   * @return string
   *   The six-digit code, or an empty string.
   */
  public function pendingCode(): string {
    return $this->pendingCode;
  }

  /**
   * The destination the mail currently being built should carry.
   *
   * @return string
   *   The destination, or an empty string.
   */
  public function pendingDestination(): string {
    return $this->pendingDestination;
  }

  /**
   * The claim URL the mail currently being built should carry.
   *
   * @return string
   *   The URL, or an empty string.
   */
  public function pendingLoginUrl(): string {
    return $this->pendingLoginUrl;
  }

  /**
   * Constructs the login service.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Finds and creates the account.
   * @param \Drupal\Core\Database\Connection $database
   *   Carries the explicit transaction the account creation runs in.
   * @param \Psr\Log\LoggerInterface $logger
   *   Records a created account and a refused blocked one.
   * @param \Drupal\bb_login\LoginCode $loginCode
   *   Issues the six-digit code that rides along with the link.
   * @param \Drupal\bb_login\PendingSignup $pendingSignup
   *   Issues the nonce an unknown address is mailed instead of an account.
   * @param \Drupal\Core\Mail\MailManagerInterface $mailManager
   *   Sends the pending sign-up's own mail, which core's
   *   `_user_mail_notify()` cannot: it takes an account this branch does not
   *   have.
   * @param \Drupal\Core\Language\LanguageManagerInterface $languageManager
   *   Supplies the langcode the pending sign-up's mail is built in.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $configFactory
   *   Reads the site's notification address for the pending sign-up's mail.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly Connection $database,
    private readonly LoggerInterface $logger,
    private readonly LoginCode $loginCode,
    private readonly PendingSignup $pendingSignup,
    private readonly MailManagerInterface $mailManager,
    private readonly LanguageManagerInterface $languageManager,
    private readonly ConfigFactoryInterface $configFactory,
  ) {}

  /**
   * Mails a one-time login link to the address, creating the account if new.
   *
   * RETURNS NOTHING, ON PURPOSE. See the class docblock: the three outcomes —
   * account created and mailed, existing account mailed, existing BLOCKED
   * account not mailed — are indistinguishable to the caller, so no caller can
   * leak them.
   *
   * @param string $mail
   *   The address as typed. Already validated as an e-mail by the form.
   * @param string $destination
   *   Where the customer asked to go before they were bounced to the login form
   *   form, or an empty string. Carried INTO THE MAILED LINK so the deep link
   *   survives being opened on another device — the session copy the form parks
   *   only covers the same browser.
   */
  public function requestLoginLink(string $mail, string $destination = ''): void {
    // Read back by `BbLoginMailHooks::mailAlter()`, which is the only seam
    // Drupal offers for touching a generated mail body. A property rather
    // than an argument because `_user_mail_notify()` is core's and takes
    // neither.
    $this->pendingDestination = $destination;
    $account = $this->findAccount($mail);

    if ($account === NULL) {
      // DEFERRED: the account is created when the mailed link or the code out
      // of the same mail is redeemed, not because somebody typed an address.
      // A typo, a scanner and a stranger's address now leave a row that
      // expires instead of a user nobody verified.
      //
      // WHICH MEANS THE LINK CANNOT BE CORE'S. `user_pass_reset_url()` derives
      // its token from the account's uid, `login` timestamp and password
      // hash; with no account there is nothing to derive from, so this
      // branch mails a nonce of our own and the KNOWN branch below keeps
      // core's untouched.
      $nonce = $this->pendingSignup->issue($mail);
      $this->pendingLoginUrl = Url::fromRoute('bb_login.claim', ['nonce' => $nonce], [
        'absolute' => TRUE,
        // CARRIED IN THE URL rather than appended to a generated body. The
        // known branch still needs `BbLoginMailHooks::mailAlter()`'s regex
        // because core builds that URL; here we build it, so there is
        // nothing to patch.
        'query' => $destination === '' ? [] : ['destination' => $destination],
      ])->toString();
      // UID 0 — Drupal's own "no account" — is what tells `BbCodeForm` that
      // this code names a pending sign-up rather than a user. The code
      // exists for an unknown address precisely because its ABSENCE would be
      // the membership oracle: a code that works for one address and not
      // another is readable from the confirmation screen.
      $this->pendingCode = $this->loginCode->issue($mail, 0);
      $this->mailPendingSignup($mail);
      return;
    }

    // A BLOCKED ACCOUNT GETS NO LINK, and gets the same answer anyway. Core's
    // `UserController::determineErrorRedirect()` refuses a one-time link for a
    // blocked account, so mailing one would send a key to a door that is
    // already locked — and mailing nothing must not be visible, or "your
    // account is blocked" becomes readable from the outside by comparison.
    if ($account->isBlocked()) {
      $this->logger->notice('Login link withheld for blocked account %name.', [
        '%name' => $account->getAccountName(),
      ]);
      return;
    }

    $this->pendingCode = $this->loginCode->issue($mail, (int) $account->id());
    _user_mail_notify(self::MAIL_KNOWN_ACCOUNT, $account);
  }

  /**
   * Mails a pending sign-up its link and code.
   *
   * NOT `_user_mail_notify()`, which takes an account this branch does not
   * have. The BODY is still the operator's: `BbLoginMailHooks::mail()`
   * loads `user.mail.register_no_approval_required` — the same template the
   * settings form edits — so there is one text rather than two that drift.
   *
   * @param string $mail
   *   The address to mail.
   */
  private function mailPendingSignup(string $mail): void {
    $site = $this->configFactory->get('system.site');
    $from = (string) ($site->get('mail_notification') ?: $site->get('mail'));
    $this->mailManager->mail(
      'bb_login',
      'pending_signup',
      $mail,
      $this->languageManager->getDefaultLanguage()->getId(),
      [],
      $from === '' ? NULL : $from,
    );
  }

  /**
   * Finds the account behind an address, or creates it.
   *
   * FIND BEFORE CREATE: the caller is redeeming a pending sign-up, and
   * between the mail being sent and this click the address can have gained
   * an account through the Google door (`bb_login_oauth`) or through a
   * second sign-in request that was redeemed first. Creating unconditionally
   * would produce the duplicate account this product has always refused.
   *
   * Public because the claim controller and the code form share it.
   *
   * @param string $mail
   *   The address to resolve.
   *
   * @return \Drupal\user\UserInterface|null
   *   The existing or newly created account, or NULL when creation failed.
   */
  public function findOrCreateAccount(string $mail): ?UserInterface {
    return $this->findAccount($mail) ?? $this->createAccount($mail);
  }

  /**
   * Loads the account holding this address, case-insensitively.
   *
   * CASE-INSENSITIVE BY THE COLUMN'S COLLATION, not by a filter of ours.
   * `loadByProperties()` builds an entity query whose `mail` condition runs
   * against a `varchar` column under the site's collation, and both supported
   * back ends collate case-insensitively by default — which is also why Drupal
   * treats two addresses differing only in case as one account. Lower-casing
   * the needle here would NOT make it more correct: it would silently stop
   * matching an address stored with capitals on a case-sensitive deployment,
   * turning a returning customer into a second account.
   *
   * @param string $mail
   *   The address to look for.
   *
   * @return \Drupal\user\UserInterface|null
   *   The account, or NULL when the address has none.
   */
  private function findAccount(string $mail): ?UserInterface {
    $matches = $this->entityTypeManager->getStorage('user')
      ->loadByProperties(['mail' => $mail]);
    $account = reset($matches);
    return $account instanceof UserInterface ? $account : NULL;
  }

  /**
   * Creates an active, passwordless account for this address.
   *
   * The explicit transaction also covers `hook_entity_insert()` listeners,
   * which run after storage's own transaction commits. No password is set, by
   * design. Public because the OAuth door creates its accounts here too.
   *
   * @param string $mail
   *   The address as typed, stored verbatim.
   *
   * @return \Drupal\user\UserInterface|null
   *   The saved account, or NULL when creation failed and was rolled back.
   */
  public function createAccount(string $mail): ?UserInterface {
    $transaction = $this->database->startTransaction();
    try {
      $storage = $this->entityTypeManager->getStorage('user');
      /** @var \Drupal\user\UserInterface $account */
      $account = $storage->create([
        'name' => $this->deriveUsername($mail),
        'mail' => $mail,
        'status' => 1,
      ]);
      $account->activate();
      $account->save();
      $this->logger->notice('Account %name created by e-mail login.', [
        '%name' => $account->getAccountName(),
      ]);
      return $account;
    }
    catch (\Throwable $error) {
      $transaction->rollBack();
      $this->logger->error('E-mail login could not create an account: @message', [
        '@message' => $error->getMessage(),
      ]);
      return NULL;
    }
  }

  /**
   * Derives a free username from an address's local part.
   *
   * The address is the identity; the name only satisfies core's unique
   * `name`. Keeping unreserved characters is stricter than
   * `UserNameConstraint`, and an all-punctuation local part falls back to a
   * stem rather than failing.
   *
   * @param string $mail
   *   The address to derive from.
   *
   * @return string
   *   A username no account currently holds.
   */
  public function deriveUsername(string $mail): string {
    $local = substr($mail, 0, (int) strpos($mail . '@', '@'));
    $stem = strtolower((string) preg_replace('/[^A-Za-z0-9._-]+/', '-', $local));
    $stem = trim($stem, '-._');
    if ($stem === '') {
      $stem = self::NAME_FALLBACK;
    }
    // Truncated BEFORE the suffix is appended, so a name at the limit can still
    // be uniquified instead of colliding forever with its own truncation.
    $limit = UserInterface::USERNAME_MAX_LENGTH - 8;
    $stem = substr($stem, 0, $limit);

    $candidate = $stem;
    $suffix = 2;
    while ($this->nameTaken($candidate)) {
      $candidate = $stem . '-' . $suffix;
      $suffix++;
    }
    return $candidate;
  }

  /**
   * Whether an account already holds this name.
   *
   * @param string $name
   *   The candidate name.
   *
   * @return bool
   *   TRUE when the name is taken.
   */
  private function nameTaken(string $name): bool {
    // `accessCheck(FALSE)`: uniqueness is a property of the table, not of what
    // the acting session may see. An access-checked query would let an
    // anonymous visitor derive a name that collides with an account they cannot
    // view, and the save would then fail on a constraint instead.
    $existing = $this->entityTypeManager->getStorage('user')->getQuery()
      ->accessCheck(FALSE)
      ->condition('name', $name)
      ->range(0, 1)
      ->execute();
    return $existing !== [];
  }

  /**
   * Whether this account may be sent a login link at all.
   *
   * Exposed for the anonymous-only guard in the form: a signed-in operator
   * asking for a login link is a confused state rather than an attack, and the
   * form answers it by sending them to the landing route instead.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The acting session.
   *
   * @return bool
   *   TRUE when the session is anonymous.
   */
  public function isLoginAllowed(AccountInterface $account): bool {
    return $account->isAnonymous();
  }

}
