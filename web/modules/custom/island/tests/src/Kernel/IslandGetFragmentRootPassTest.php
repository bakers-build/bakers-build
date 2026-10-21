<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The boosted GET fragment is a ROOT render, like the mutation fragment is.
 *
 * WHAT FAILED AND WHY IT WAS INVISIBLE (BB-489). Reaching a face by clicking
 * a boosted tab is the GET path, and that path used to render its fragments
 * without the root pass. Only the root pass substitutes Drupal's lazy-builder
 * placeholders, and a form's CSRF token and its `action` are two of them — so
 * the form arrived carrying `form_token_placeholder_<hash>` and
 * `action="form_action_p_<hash>"`. The first submit posted the placeholder
 * back, Drupal's Form API rejected the token, skipped the submit handler,
 * rebuilt the form and answered 200. Nothing errored and nothing was written;
 * the rebuilt form came back through the mutation path, which DOES resolve
 * placeholders, so the SECOND click wrote. Every symptom of the defect looked
 * like success, which is why it needs a test in the layer that owns it rather
 * than a note.
 *
 * Reaching the same face by its own URL is an ordinary page render, where the
 * root pass runs — which is why every existing scenario that entered by URL was
 * green while the surface was broken for anyone who clicked a tab.
 *
 * THIS CLASS USED TO CARRY A SECOND CASE, and it is gone with its subject
 * rather than by losing an assertion. The root pass on the GET path had been
 * excused by a real hazard: a PLACED Drupal block islandified through its own
 * configuration form resolved here to markup that already carried its own
 * wrapper, added by hook_block_view_alter inside the block's lazy builder, so
 * the pass nested a second container with the same id inside the first. The
 * first delivery answered that by having the responder claim the wrapper of
 * the ids it renders; review withdrew the block mechanism instead, because no
 * block placement in the product ever opted in. An island is placed through an
 * `island.profile.*`, no renderer competes for a fragment's wrapper, and the
 * property this second case pinned has no way left to fail.
 */
#[Group('island')]
final class IslandGetFragmentRootPassTest extends KernelTestBase {

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
   * The same, for the form's action attribute.
   */
  private const ACTION_PLACEHOLDER = 'form_action_p_';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['system', 'user']);
    $this->container->get('theme_installer')->install(['stark']);
    $this->container->get('config.factory')->getEditable('system.theme')->set('default', 'stark')->save();
    $this->container->get('router.builder')->rebuild();
    // A form is only issued a CSRF token for an AUTHENTICATED user, and the
    // token is seeded from the session. Anonymous there would be no placeholder
    // to leave behind and the first case would measure nothing.
    $this->setUpCurrentUser(['name' => 'crew']);
  }

  /**
   * A form reached by a boosted tab click can be posted on the FIRST click.
   */
  public function testTheBoostedGetFragmentResolvesTheFormPlaceholders(): void {
    $html = (string) $this->boostedGet('island-tasks-task_form')->getContent();

    self::assertStringContainsString(
      'name="form_token"',
      $html,
      'the fragment really does carry a form with a token element',
    );
    self::assertStringNotContainsString(
      self::TOKEN_PLACEHOLDER,
      $html,
      'the GET path resolved the token, so this form can be posted on the first click',
    );
    self::assertStringNotContainsString(
      self::ACTION_PLACEHOLDER,
      $html,
      'the GET path resolved the form action, so the first submit reaches the right route',
    );
    self::assertStringNotContainsString(
      'drupal-render-placeholder',
      $html,
      'every lazy builder in the fragment resolved server-side',
    );
  }

  /**
   * Issues one boosted island GET for a single target id.
   */
  private function boostedGet(string $target): Response {
    $request = Request::create('/island-test');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->headers->set('HX-Request', 'true');
    $request->headers->set('HX-Boosted', 'true');
    $request->headers->set('HX-Target', $target);

    return $this->container->get('http_kernel')->handle($request);
  }

}
