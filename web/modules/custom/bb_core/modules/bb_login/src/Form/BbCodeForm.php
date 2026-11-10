<?php

declare(strict_types=1);

namespace Drupal\bb_login\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Flood\FloodInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_login\Controller\BbOneTimeLoginController;
use Drupal\bb_login\EmailLogin;
use Drupal\bb_login\LoginCode;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The "check your mail" screen, with the code field that makes it act.
 *
 * The link is the fast path; this is where the code from the same mail is
 * typed. The address comes from the session, never the request, so nobody
 * can aim guesses at another address. A wrong code is not consumed; the
 * per-address attempt limit does the security work.
 */
final class BbCodeForm extends FormBase {

  /**
   * The session key the pending address is parked under.
   *
   * Written by `BbLoginForm` on submit; read here and nowhere else.
   */
  public const PENDING_MAIL_KEY = 'bb_login.pending_mail';

  /**
   * The marker the check-mail document carries, so a browser check can anchor.
   *
   * Same shape as `BbHomeController::BODY_ATTRIBUTE`: a named state rather
   * than a bare presence, because the failure a check has to catch is this
   * screen being swapped for the login form or for the landing page, and all
   * three would otherwise look like "a page rendered".
   */
  public const BODY_ATTRIBUTE = 'data-bakers-check-mail-body';

  /**
   * Constructs the code form.
   *
   * @param \Drupal\bb_login\LoginCode $loginCode
   *   Verifies and consumes the code.
   * @param \Drupal\Core\Flood\FloodInterface $flood
   *   Counts wrong codes per address and per client, which is what makes
   *   six digits safe.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Loads the account the code names.
   * @param \Drupal\bb_login\EmailLogin $emailLogin
   *   Finds or creates the account behind a pending sign-up's code.
   */
  public function __construct(
    private readonly LoginCode $loginCode,
    private readonly FloodInterface $flood,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EmailLogin $emailLogin,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_login.login_code'),
      $container->get('flood'),
      $container->get('entity_type.manager'),
      $container->get('bb_login.email_login'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_login_code_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['#attributes']['data-hx-boost'] = 'false';
    // A NAMED STATE ON THE DOCUMENT, so a browser check can tell this screen
    // apart from the login form and the landing page — all three would
    // otherwise look like "a page rendered".
    $form['#attributes'][self::BODY_ATTRIBUTE] = 'sent';
    // The gate chrome's h1 is the product mark. This screen's title lives on
    // the form, because PageContent no longer emits a heading of its own.
    $form['heading'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $this->t('Check your mail'),
        'as' => 'h1',
        'size' => 'section-title',
        'align' => 'center',
      ],
      '#weight' => -20,
    ];
    // THE CONFIRMATION SENTENCE IS PART OF THE PAGE, not a `Messenger` status:
    // a fixed paragraph is identical for known and unknown addresses, so it
    // cannot become an oracle. The address is not echoed.
    $form['sent'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $this->t('We sent you a login link. Open it on this device to sign in. The link works only once.'),
        'tone' => 'light',
      ],
      '#weight' => -10,
    ];
    $form['code'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Code from the e-mail'),
      '#required' => TRUE,
      '#required_error' => $this->t('Please enter the code from the e-mail.'),
      '#maxlength' => 16,
      '#attributes' => [
        // `inputmode` rather than `type="number"`: a numeric keypad on a phone
        // without the spinner, the scroll-to-change hazard and the silent
        // value loss that `number` brings to a code that is a STRING with
        // possible leading zeros.
        'inputmode' => 'numeric',
        'autocomplete' => 'one-time-code',
        'autocapitalize' => 'none',
        'spellcheck' => 'false',
      ],
      '#description' => $this->t('Six digits, valid for 15 minutes. You can also just open the link in the e-mail instead.'),
      '#description_display' => 'after',
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Sign in'),
      '#theme_wrappers' => ['input__submit__bb_button'],
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $mail = $this->pendingMail();
    if ($mail === '') {
      // No address parked means this browser never submitted the login form —
      // a bookmarked or shared confirmation URL. Nothing is disclosed and
      // nothing is counted; the customer is simply asked to start.
      $form_state->setErrorByName('code', $this->t('Please request a login link first.'));
      return;
    }
    if (!$this->flood->isAllowed(LoginCode::FLOOD_EVENT, LoginCode::MAX_ATTEMPTS, LoginCode::TTL, $mail)
      || !$this->flood->isAllowed(LoginCode::CLIENT_FLOOD_EVENT, LoginCode::MAX_CLIENT_ATTEMPTS, LoginCode::CLIENT_WINDOW)) {
      $this->logger('bb_login')->notice('Login code attempts blocked for %mail.', ['%mail' => $mail]);
      $form_state->setErrorByName('code', $this->t('Too many attempts. Please request a new login link.'));
      return;
    }

    $uid = $this->loginCode->claim($mail, (string) $form_state->getValue('code'));
    if ($uid === NULL) {
      // COUNTED ONLY ON A WRONG CODE, so a customer who types it correctly the
      // first time never approaches the limit.
      $this->flood->register(LoginCode::FLOOD_EVENT, LoginCode::TTL, $mail);
      // Never cleared on success, so signing in to one account does not
      // reset a client's budget against the others.
      $this->flood->register(LoginCode::CLIENT_FLOOD_EVENT, LoginCode::CLIENT_WINDOW);
      $this->logger('bb_login')->notice('Wrong login code for %mail.', ['%mail' => $mail]);
      $form_state->setErrorByName('code', $this->t('This code is wrong or has expired.'));
      return;
    }
    $form_state->set('bb_login_uid', $uid);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // READ BEFORE THE SESSION KEY IS REMOVED: a pending sign-up's code has no
    // account to load by uid, only the address this browser asked for.
    $mail = $this->pendingMail();
    $uid = (int) $form_state->get('bb_login_uid');
    $account = $this->resolveAccount($uid, $mail);
    if ($account === NULL) {
      // NON-EXCEPTIONAL HERE: creation can genuinely fail (a save error, a
      // name collision that outlasted the retry), and the claim controller
      // answers the identical failure with a message rather than a throw.
      // One condition, one answer, on both doors.
      $form_state->setErrorByName('code', $this->t('Your account could not be created. Please try again.'));
      return;
    }

    // A BLOCKED ACCOUNT GETS NO SESSION, same rule and the same neutral
    // answer `BbSignupClaimController` gives its own doors: within the
    // code's lifetime the address can have gained an account that was then
    // blocked, and `findOrCreateAccount()`'s "found" half does not check
    // status.
    if ($account->isBlocked()) {
      $form_state->setErrorByName('code', $this->t('Please request a login link first.'));
      return;
    }

    $session = $this->getRequest()->getSession();
    $session->remove(self::PENDING_MAIL_KEY);
    $this->flood->clear(LoginCode::FLOOD_EVENT, (string) $account->getEmail());

    // CORE FINALISES THE LOGIN, because a session is not something to assemble
    // by hand: `user_login_finalize()` regenerates the session id, updates the
    // login timestamp — which is what invalidates the LINK from the same mail,
    // so the pair really is spent once — and fires the hooks other modules
    // rely on.
    user_login_finalize($account);

    // The destination the login form parked, handed to core's
    // `RedirectResponseSubscriber` rather than applied here, so its
    // open-redirect validation stays the single implementation.
    $destination = (string) $session->get(BbOneTimeLoginController::DESTINATION_KEY, '');
    if ($destination !== '') {
      $session->remove(BbOneTimeLoginController::DESTINATION_KEY);
      $this->getRequest()->query->set('destination', $destination);
    }
    $form_state->setRedirect('bb_core.home');
  }

  /**
   * The account a claimed code names.
   *
   * UID 0 IS DRUPAL'S "NO ACCOUNT", and it is what a pending sign-up's code
   * was issued under: the account is created HERE, by the act of proving the
   * mailbox, exactly as the link path creates it. A non-zero uid is the only
   * kind this branch ever saw before account creation moved onto this form —
   * `LoginCode::claim()` only ever hands back a uid it read off an existing
   * account — so `NULL` there still means "impossible" and stays a throw
   * rather than a user-facing error.
   *
   * @param int $uid
   *   The uid `LoginCode::claim()` resolved, or 0 for a pending sign-up.
   * @param string $mail
   *   The address this browser asked for a link with.
   *
   * @return \Drupal\user\UserInterface|null
   *   The account, or NULL when a pending sign-up's account could not be
   *   created.
   */
  private function resolveAccount(int $uid, string $mail): ?UserInterface {
    if ($uid !== 0) {
      $account = $this->entityTypeManager->getStorage('user')->load($uid);
      if (!$account instanceof UserInterface) {
        throw new \RuntimeException('The claimed code names no loadable account.');
      }
      return $account;
    }
    return $this->emailLogin->findOrCreateAccount($mail);
  }

  /**
   * The address this browser asked for a link with.
   *
   * @return string
   *   The address, or an empty string when none is parked.
   */
  private function pendingMail(): string {
    return (string) $this->getRequest()->getSession()->get(self::PENDING_MAIL_KEY, '');
  }

}
