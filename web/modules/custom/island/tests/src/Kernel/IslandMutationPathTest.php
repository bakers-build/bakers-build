<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandInterface;
use Drupal\island\IslandResponse;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The mutation path renders through the ROOT pass, so its forms can be posted.
 *
 * WHY THIS TEST EXISTS AND WHY IT IS HERE. IslandResponder::toResponse() root-
 * renders every island form submit in the application, and it started doing so
 * to fix a defect found from a consumer — which meant application-wide
 * behaviour changed with no coverage in the module that owns it. A test in the
 * consumer would assert this by accident: it would go green for as long as that
 * one surface happened to exercise the responder, and say nothing about the
 * next island to submit a form.
 *
 * THE DEFECT IT PINS, stated so a reader knows what a failure here means. A
 * form's CSRF token is not emitted as a value. It is emitted as a PLACEHOLDER —
 * `form_token_placeholder_<hash>` — with a lazy builder attached, and only a
 * root render pass substitutes it. A fragment rendered without that pass ships
 * the placeholder string itself, the browser posts it back, Drupal rejects the
 * token, rebuilds the form and answers 200. Nothing errors anywhere; the write
 * simply does not happen. That silence is why this needs a test rather than a
 * docblock: every symptom of it looks like success.
 *
 * THERE IS NO LONGER AN ASYMMETRY TO PIN. The root pass used to be a
 * parameter, so that the boosted GET path could skip it; BB-489 found that
 * skipping it is exactly what made a membership action need two clicks, and
 * removed the choice. Both cases below therefore assert the same property from
 * the two ends that can reach it — the mutation caller and the seam itself.
 * The GET end is IslandGetFragmentRootPassTest, which also holds the
 * block-wrapper bargain that the parameter used to buy.
 */
#[Group('island')]
final class IslandMutationPathTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'island', 'island_test'];

  /**
   * The marker core leaves behind when a form is rendered outside the root.
   */
  private const TOKEN_PLACEHOLDER = 'form_token_placeholder_';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['system', 'user']);

    // A form only gets a CSRF token when an AUTHENTICATED user is looking at
    // it, and the token is seeded from the session. Anonymous and session-less,
    // there would be no placeholder at all and both cases below would pass
    // while measuring nothing.
    $request = Request::create('/island-mutation-path-test');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $this->setUpCurrentUser(['name' => 'crew']);
  }

  /**
   * A mutation's fragment carries a REAL token, not the placeholder.
   */
  public function testTheMutationResponseResolvesTheFormTokenPlaceholder(): void {
    [$island, $host] = $this->formIsland();

    $response = $this->container->get('island.responder')->toResponse(
      IslandResponse::make()->rebuildSelf(),
      $island,
      $host,
    );
    $html = (string) $response->getContent();

    self::assertStringContainsString(
      'name="form_token"',
      $html,
      'the fragment really does carry a form with a token element',
    );
    self::assertStringNotContainsString(
      self::TOKEN_PLACEHOLDER,
      $html,
      'the mutation path resolved the token, so this form can actually be posted',
    );
  }

  /**
   * The seam itself resolves it, for whichever caller reaches it.
   *
   * This method used to be the control for the case above, and it asserted the
   * opposite: called with the root flag off, the same fragment kept its
   * placeholder. That flag is gone (BB-489). It existed so the boosted GET
   * path could skip the pass, on a measurement that turned out to be false, and
   * skipping it is precisely how a membership action came to need two clicks.
   * So the contract this pins is the new one — the seam root-renders, and no
   * caller can opt a form out of being postable.
   */
  public function testTheSeamResolvesTheTokenForEveryCaller(): void {
    [$island, $host] = $this->formIsland();
    $fragments = [
      'self' => [
        'id' => $island->getHtmlId($host->hostId()),
        'content' => $island->build($host->getIslandData($island->getPluginId())),
        'oob' => FALSE,
        'boost' => $island->boost(),
      ],
    ];

    $html = (string) $this->container->get('island.responder')
      ->toFragmentResponse($fragments)
      ->getContent();

    self::assertStringContainsString(
      'name="form_token"',
      $html,
      'the seam really did render the form',
    );
    self::assertStringNotContainsString(
      self::TOKEN_PLACEHOLDER,
      $html,
      'the seam resolves the token itself rather than leaving it to its caller',
    );
  }

  /**
   * The fixture island whose build carries a form, wired to its host.
   *
   * @return array{0: \Drupal\island\IslandInterface, 1: \Drupal\island\IslandContextProviderInterface}
   *   The island instance and its host, in the order the responder takes them.
   */
  private function formIsland(): array {
    $host = $this->container->get('island.host_resolver')->resolve('tasks');
    self::assertInstanceOf(IslandContextProviderInterface::class, $host);
    $island = $this->container->get('plugin.manager.island')
      ->createInstance('task_form', ['contexts' => ['host' => $host]]);
    self::assertInstanceOf(IslandInterface::class, $island);

    return [$island, $host];
  }

}
