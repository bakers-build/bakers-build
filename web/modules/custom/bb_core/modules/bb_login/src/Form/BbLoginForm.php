<?php

declare(strict_types=1);

namespace Drupal\bb_login\Form;

use Drupal\Component\Utility\EmailValidatorInterface;
use Drupal\Core\Flood\FloodInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_login\Controller\BbOneTimeLoginController;
use Drupal\bb_login\Form\BbCodeForm as CodeForm;
use Drupal\bb_login\EmailLogin;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The whole door: one e-mail field, mounted on `user.login`.
 *
 * One form serves sign-in and implicit sign-up, because whether an account
 * exists must not be visible. It replaces core's login form on `user.login`,
 * so no anonymous route accepts a password; `/user/register` stays a 403.
 * Flood control lives here, before any mail is sent, as the mail-bomb guard
 * that replaces core's `user.flood` login limits.
 *.
 */
final class BbLoginForm extends FormBase {

  /**
   * The flood event counting attempts from one client.
   */
  private const FLOOD_IP = 'bb_login.login_ip';

  /**
   * The flood event counting attempts for one address.
   */
  private const FLOOD_MAIL = 'bb_login.login_mail';

  /**
   * Constructs the login form.
   *
   * `request_stack` and `config.factory` are not injected: `FormBase` already
   * declares them non-readonly, so promoting them here is fatal. Use the
   * inherited `getRequest()` and `config()`.
   *
   * @param \Drupal\bb_login\EmailLogin $emailLogin
   *   Finds or creates the account and mails the link.
   * @param \Drupal\Core\Flood\FloodInterface $flood
   *   Counts and refuses repeated attempts.
   * @param \Drupal\Component\Utility\EmailValidatorInterface $emailValidator
   *   Core's own address validator, so this form and core agree on what an
   *   e-mail address is.
   */
  public function __construct(
    private readonly EmailLogin $emailLogin,
    private readonly FloodInterface $flood,
    private readonly EmailValidatorInterface $emailValidator,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_login.email_login'),
      $container->get('flood'),
      $container->get('email.validator'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    // THE THEME HOOK IS THIS STRING. `bb_theme_theme()` registers
    // `bb_login_form` with `render element: form`, and formdazzle resolves
    // the wrapper to `form--bb-login-form.html.twig`. Renaming this id
    // silently drops both templates back to core's markup.
    return 'bb_login_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    // Parked on the GET too, for the Google button, which is a plain link.
    // A GET answers 200, so `RedirectResponseSubscriber` cannot act on it;
    // `?destination` on the button's href would hijack the redirect to Google.
    $destination = (string) $this->getRequest()->query->get('destination', '');
    if ($destination !== '') {
      $this->getRequest()->getSession()->set(BbOneTimeLoginController::DESTINATION_KEY, $destination);
    }

    $form['mail'] = [
      '#type' => 'email',
      '#title' => $this->t('E-mail address'),
      '#required' => TRUE,
      // `#required` ALONE BYPASSES THIS FORM'S OWN MESSAGE. Core's
      // `FormValidator` emits "@name field is required." for an empty
      // required element and never reaches this form's own validation, so
      // the sentence below would have been unreachable — a browser check
      // caught exactly that. `#required_error` is the documented seam for
      // replacing it.
      '#required_error' => $this->t('Please enter your e-mail address.'),
      // AND `#element_validate` REPLACES CORE'S OWN for the same reason.
      // `Drupal\Core\Render\Element\Email` declares
      // `#element_validate => [[Email::class, 'validateEmail']]`, and element
      // validation runs BEFORE `validateForm()` — so core's own "%name is not
      // a valid email address." reached the customer and this form's own
      // sentence never did. Replacing the callback keeps `type="email"` (the
      // phone keyboard) while owning the message.
      '#element_validate' => [[$this, 'validateAddress']],
      // `#type => email` already emits `type="email"`, which is what gives a
      // phone keyboard the @ key. `autocomplete` is the half
      // core does not add and a password manager needs.
      '#attributes' => [
        'autocomplete' => 'email',
        'autocapitalize' => 'none',
        'spellcheck' => 'false',
      ],
      '#description' => $this->t('We will send you a login link. No password needed.'),
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Send login link'),
      // Renders the submit as a real `<button>` through
      // `input--submit--bb-button.html.twig`, so it agrees with every other
      // primary control in the product rather than being core's `<input>`.
      '#theme_wrappers' => ['input__submit__bb_button'],
    ];
    // THE SECOND DOOR, AND DELIBERATELY NOT A BLOCK. social_auth ships a login
    // block; placing it would mean a block placement and a page-layout change
    // for what is one anchor. `island.profile.bb_gate` already frames
    // `/user/login`, so rendering it here puts it inside the same gate card as
    // the e-mail field with no new plumbing and no island — a link that
    // navigates needs none.
    $form['oauth'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'label' => $this->t('Continue with Google'),
        'href' => '/user/login/google',
      ],
      // NOT A `#props` KEY. The button component's schema declares no
      // `attributes` property, and SDC drops undeclared props silently —
      // `#attributes` is the render-array key SDC merges onto the root
      // element's own attribute bag instead. `OauthButtonKernelTest` asserts
      // on the rendered markup.
      '#attributes' => ['data-test' => 'oauth-google'],
      '#slots' => [
        'icon' => ['#type' => 'icon', '#pack_id' => 'bakers', '#icon_id' => 'google', '#settings' => ['size' => 'md']],
      ],
      '#weight' => 10,
    ];
    return $form;
  }

  /**
   * Validates the address, in place of core's own element validator.
   *
   * BY VALUE, THOUGH `#element_validate` PASSES BY REFERENCE. `FormValidator`
   * hands the element over as `&$elements`, and PHP accepts that into a
   * by-value parameter — which is honest here, because this callback only READS
   * the element: the error goes on the FORM STATE, never on the element. A
   * `&$element` would be promising a write it never makes.
   *
   * @param array<string, mixed> $element
   *   The e-mail element.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function validateAddress(array $element, FormStateInterface $form_state): void {
    $value = trim((string) $element['#value']);
    if ($value !== '' && !$this->emailValidator->isValid($value)) {
      // ON THE FIELD. `setError()` on the ELEMENT is what makes core attach
      // `aria-invalid` and `aria-describedby` to this input, so a screen
      // reader announces the failure where it happened.
      $form_state->setError($element, $this->t('%mail is not a valid e-mail address.', ['%mail' => $value]));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $mail = trim((string) $form_state->getValue('mail'));

    // ON THE FIELD. `setErrorByName('mail', …)` is what makes core attach
    // `aria-describedby` and `aria-invalid` to the input, so a screen reader
    // announces the failure where it happened. A `setError()`
    // on the form would render the same sentence in a place no assistive
    // technology associates with the field.
    if ($mail === '') {
      $form_state->setErrorByName('mail', $this->t('Please enter your e-mail address.'));
      return;
    }
    // CHECKED BEFORE ANYTHING IS SENT, and counted per client AND per address.
    // The per-address limit is the mail-bomb guard: without it one client could
    // rotate addresses under the IP limit and this form would deliver mail to
    // any third party on demand.
    $limits = $this->config('user.flood');
    $ip = (string) $this->getRequest()->getClientIp();
    $ipAllowed = $this->flood->isAllowed(
      self::FLOOD_IP,
      (int) $limits->get('ip_limit'),
      (int) $limits->get('ip_window'),
      $ip,
    );
    $mailAllowed = $this->flood->isAllowed(
      self::FLOOD_MAIL,
      (int) $limits->get('user_limit'),
      (int) $limits->get('user_window'),
      // KEYED BY THE ADDRESS ALONE, not by address plus IP. Keying by both
      // would let one client bypass the address limit by changing network,
      // which is exactly the mail-bomb case, and the address is not a secret
      // this identifier could leak — it was just typed into a public form.
      mb_strtolower($mail),
    );
    if (!$ipAllowed || !$mailAllowed) {
      $form_state->setErrorByName('mail', $this->t('Too many attempts. Please try again later.'));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $mail = trim((string) $form_state->getValue('mail'));

    // REGISTERED FOR EVERY ATTEMPT THAT GETS THIS FAR, before the branch below
    // and regardless of which way it goes. Registering only on the
    // account-creating branch would make the flood table itself an oracle for
    // whoever can read it, and would leave the mail-bomb case uncounted.
    $limits = $this->config('user.flood');
    $this->flood->register(
      self::FLOOD_IP,
      (int) $limits->get('ip_window'),
      (string) $this->getRequest()->getClientIp(),
    );
    $this->flood->register(
      self::FLOOD_MAIL,
      (int) $limits->get('user_window'),
      mb_strtolower($mail),
    );

    // THE DESTINATION IS TAKEN OFF THIS REQUEST BEFORE ANYTHING REDIRECTS, and
    // that order is the whole point. The login form is reached as
    // `/user/login?destination=/x` whenever r4032login bounced a deep link, and
    // the form posts back to that same address — so core's
    // `RedirectResponseSubscriber` would override the confirmation redirect
    // below with the deep link, sending a still-anonymous visitor to a 403 that
    // r4032login turns straight back into this form. The customer would never
    // see "Check your mail" and would read the submit as having failed.
    //
    // Parked in the session instead, where `BbOneTimeLoginController` picks
    // it up after the login it belongs to. Removing the query parameter is what
    // stops the subscriber acting on it now.
    $request = $this->getRequest();
    $destination = (string) $request->query->get('destination', '');
    if ($destination !== '') {
      $request->getSession()->set(BbOneTimeLoginController::DESTINATION_KEY, $destination);
      $request->query->remove('destination');
    }

    // PARKED FOR THE CODE FORM, and this is what keeps the attempt limit
    // meaningful: the confirmation screen verifies codes only against the
    // address THIS browser asked for, so nobody can aim guesses at somebody
    // else's address.
    $request->getSession()->set(CodeForm::PENDING_MAIL_KEY, $mail);

    $this->emailLogin->requestLoginLink($mail, $destination);

    // ONE ANSWER FOR EVERY OUTCOME: the same route, the same status, and
    // no message naming what happened. The confirmation screen carries the
    // sentence, so this handler renders no `addStatus()` that a known and an
    // unknown address could differ in.
    $form_state->setRedirect('bb_login.check_mail');
  }

}
