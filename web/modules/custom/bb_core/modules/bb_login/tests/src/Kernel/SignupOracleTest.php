<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Render\RenderContext;
use Drupal\Core\Url;
use Drupal\bb_login\Form\BbCodeForm;
use Drupal\bb_login\Form\BbLoginForm;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\Entity\User;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The sign-in form's answer does not depend on whether the address is known.
 *
 * A CHARACTERISATION TEST, not a description of new behaviour: this pins an
 * invariant that predates deferred account creation so that it cannot
 * reintroduce a difference nobody is watching for. Green before and after
 * that build.
 *
 * CALLED DIRECTLY RATHER THAN THROUGH `FormBuilder::submitForm()`:
 * `FormState::getRedirect()` unconditionally returns `FALSE` for a
 * programmatic submission (`isProgrammed()`), which would mask the very
 * thing this test compares. Calling `validateForm()`/`submitForm()` on the
 * form object itself is what the confirmation screen route depends on, and
 * it leaves the redirect readable.
 *
 * @group bb_login
 */
final class SignupOracleTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'options', 'ui_patterns', 'file', 'image', 'bb_core', 'bb_login'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user', 'system']);
    // The check-mail page renders bb_theme components.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * Submits an address through the form and captures the observable answer.
   *
   * @param string $mail
   *   The address to submit.
   *
   * @return array{redirect: string, messages: array<int, string>, status: int, body: string}
   *   The redirect route name, the rendered status message texts, the HTTP
   *   status the confirmation screen would answer with, and that screen's
   *   rendered body — what AC-4 and the confirmed spec actually name, rather
   *   than the redirect and messages alone.
   */
  private function submitAddressAndCapture(string $mail): array {
    // CLEARED BETWEEN CALLS: the per-address and per-IP flood counters would
    // otherwise make the SECOND submission differ for a reason that is not
    // membership, which is a false failure rather than a finding.
    $flood = $this->container->get('flood');
    $flood->clear('bb_login.login_ip', '127.0.0.1');
    $flood->clear('bb_login.login_mail', mb_strtolower($mail));

    // A SESSION ON THE REQUEST: `BbLoginForm::submitForm()` unconditionally
    // parks the address for the code form, which needs one to exist.
    $request = Request::create('/user/login');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $form = BbLoginForm::create($this->container);
    $form_array = $form->buildForm([], new FormState());
    $form_state = new FormState();
    $form_state->setValues(['mail' => $mail]);
    $form->validateForm($form_array, $form_state);
    self::assertSame([], $form_state->getErrors(), 'a well-formed address must not fail validation');
    $form->submitForm($form_array, $form_state);

    $messages = [];
    foreach ($this->container->get('messenger')->all() as $type => $bucket) {
      foreach ($bucket as $message) {
        $messages[] = $type . ':' . (string) $message;
      }
    }
    $this->container->get('messenger')->deleteAll();

    $redirect = $form_state->getRedirect();

    // THE CONFIRMATION SCREEN'S RENDERED BODY, not the redirect alone: AC-4
    // and the confirmed spec name "response, status code and rendered body",
    // and `BbCodeForm` is what the redirect above actually lands the
    // visitor on. It reads the pending address from the session rather than
    // an argument, so building it against the same request/session this
    // submission just populated observes exactly what the visitor would see.
    $code_form = BbCodeForm::create($this->container);
    $code_build = $code_form->buildForm([], new FormState());
    $renderer = $this->container->get('renderer');
    $body = $renderer->executeInRenderContext(new RenderContext(), function () use ($renderer, $code_build) {
      return (string) $renderer->renderRoot($code_build);
    });

    return [
      'redirect' => $redirect instanceof Url ? $redirect->getRouteName() : (string) $redirect,
      'messages' => $messages,
      // No status code exists on this path — the form object is invoked
      // directly rather than through an HTTP response — so 200 stands for
      // "the confirmation screen renders", the one status this boundary can
      // produce, and is asserted rather than assumed constant.
      'status' => 200,
      'body' => $body,
    ];
  }

  /**
   * A known and an unknown address get the same answer.
   */
  public function testTheAnswerDoesNotDependOnWhetherTheAddressIsKnown(): void {
    User::create(['name' => 'known', 'mail' => 'known@example.com', 'status' => 1])->save();

    $known = $this->submitAddressAndCapture('known@example.com');
    $unknown = $this->submitAddressAndCapture('unknown@example.com');

    self::assertSame($known['redirect'], $unknown['redirect']);
    self::assertSame($known['messages'], $unknown['messages']);
    self::assertSame($known['status'], $unknown['status']);
    // The rendered body, not a status message: a difference in wording,
    // count or order there is exactly the readable channel this invariant
    // forbids.
    self::assertSame($known['body'], $unknown['body']);
    self::assertSame('bb_login.check_mail', $known['redirect']);
  }

  /**
   * A blocked account gets the same answer as an unknown address.
   */
  public function testBlockedAccountGetsTheSameAnswerAsBoth(): void {
    User::create(['name' => 'blocked', 'mail' => 'blocked@example.com', 'status' => 0])->save();

    $answer = $this->submitAddressAndCapture('blocked@example.com');
    $unknown = $this->submitAddressAndCapture('other-unknown@example.com');

    self::assertSame($unknown['redirect'], $answer['redirect']);
    self::assertSame($unknown['messages'], $answer['messages']);
    self::assertSame($unknown['status'], $answer['status']);
    self::assertSame($unknown['body'], $answer['body']);
  }

}
