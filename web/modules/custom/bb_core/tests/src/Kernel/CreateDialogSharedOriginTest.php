<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Render\Element;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Routing\RouteMatch;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\BbProjectCreateForm;
use Drupal\bb_core\Form\BbGroupTeamCreateForm;
use Drupal\bb_core\Form\BbCreateDialogFormBase;
use Drupal\island\Render\WrappedRouteRenderer;
use Drupal\bb_core\Form\BbTicketCreateForm;
use Drupal\bb_core\Plugin\UiPatterns\Source\ProjectCreateActionSource;
use Drupal\bb_core\Plugin\UiPatterns\Source\TicketCreateActionSource;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * AC6: a create dialog that was COPIED instead of shared fails a test.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CreateDialogSharedOriginTest extends KernelTestBase {

  use UserCreationTrait;
  use ShippedImageConfigTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'crop', 'bb_image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   *
   * The two render cases need a world; the structural cases need none and pay
   * for it, which is the price of keeping spec D8's checks in the one file an
   * operator reads to answer "is this shared?".
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_workspace',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_term', 'bb_team',
      'bb_environment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    $this->installShippedFormDisplays();
    // Both dialogs are composed by the THEME's components — `bb_theme:dialog`
    // is what `island:dialog` resolves to, by declaring `replaces` — so the
    // theme has to be installed and active for any of this to render at all.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    // Uid 1 bypasses every access check, so it must not be an actor.
    $this->newAccount([], 'uid1-dummy-shared-origin');
    $this->setCurrentUser($this->newAccount(
      ['administer bakers', 'create bb_ticket', 'create bb_project'],
      'shared-origin',
    ));

    $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'Shared-origin project'])
      ->save();
  }

  /**
   * Every subject uses one action row and one save/finish chain.
   */
  public function testAllSubjectsShareTheSubmissionLifecycle(): void {
    foreach ([BbTicketCreateForm::class, BbProjectCreateForm::class, BbGroupTeamCreateForm::class] as $class) {
      $methods = ['actions', 'landAtReturnUrl'];
      // The ticket dialog adds its own relation rule on top of the shared
      // validation (Parent and Blocked by stay in the new ticket's project).
      if ($class === BbProjectCreateForm::class) {
        self::assertSame(ContentEntityForm::class, (new \ReflectionMethod($class, 'validateForm'))->getDeclaringClass()->getName());
      }
      foreach ($methods as $method) {
        self::assertSame(BbCreateDialogFormBase::class, (new \ReflectionMethod($class, $method))->getDeclaringClass()->getName(), "$class::$method must use the shared lifecycle.");
      }
    }
  }

  /**
   * The ticket dialog keeps only what is genuinely its own.
   */
  public function testTheTicketDialogDeclaresOnlyItsSubject(): void {
    self::assertSame([], $this->declaredBeyond(BbTicketCreateForm::class, [
      'create', 'getFormId', 'actionLabels', 'init', 'alterFormDisplay', 'copyFormValuesToEntity',
      // Parent and Blocked by are scoped to the new ticket's project: the
      // refresh on a project change and the server-side rule.
      'form', 'attachRelationRefresh', 'validateForm', 'rejectProjectScopedRelations',
    ]));
  }

  /**
   * Exactly one template in this module composes the surface component.
   *
   * `bb_theme:form` IS the surface — the `lead` / `lines` / `pills`
   * grammar — so the file that names it is the file that owns how a create
   * dialog looks. There is one, and every create dialog reaches it by stating
   * it as `#theme` and writing no template at all. A second file naming the
   * component is a fork of the grammar, whether or not it happens to render
   * the same today.
   *
   * IT USED TO BE ONE FILE PLUS AN `include()` FROM A SECOND: the ticket
   * dialog's own hull template pulled this body in. That template is gone with
   * the one-hull ruling, so the count is unchanged and the reason is simpler.
   */
  public function testExactlyOneTemplateComposesTheSurface(): void {
    self::assertSame(
      ['bb-create-dialog.html.twig'],
      $this->templatesContaining('bb_core', 'bb_theme:form'),
    );
  }

  /**
   * The project dialog keeps only what is genuinely its own.
   *
   * `form()` is in the allow-list because the project dialog, alone among
   * create dialogs, hides two inputs on the create surface (D5, amended
   * `9d718d2a`) — that requires overriding the element tree `form()` builds,
   * which no shared base method exposes. The ticket dialog has no such
   * override.
   */
  public function testTheProjectDialogDeclaresOnlyItsSubject(): void {
    self::assertSame([], $this->declaredBeyond(BbProjectCreateForm::class, [
      'create', 'getFormId', 'actionLabels',
      'copyFormValuesToEntity', 'formDisplayMode', 'form',
    ]));
  }

  /**
   * The TRIGGER that opens each dialog declares only its subject either.
   */
  public function testEachCreateTriggerDeclaresOnlyItsSubject(): void {
    foreach ([TicketCreateActionSource::class, ProjectCreateActionSource::class] as $class) {
      $allowed = [
        'dialogRoute', 'triggerLabel', 'forwardsScreenQuery',
        'appliesToCurrentRoute',
      ];
      // BB-664: only the ticket trigger overrides this, to force its
      // per-project screen's ROUTE context onto the dialog, which the
      // forwarded screen query alone cannot carry.
      if ($class === TicketCreateActionSource::class) {
        $allowed[] = 'routeBoundQuery';
      }
      self::assertSame(
        [],
        $this->declaredBeyond($class, $allowed),
        $class . ' declares more than its subject — the plumbing belongs to CreateActionSourceBase.',
      );
    }
  }

  /**
   * AC6, the criterion's plainest reading: both dialogs are the same two nodes.
   */
  public function testBothDialogsRenderTheSameComponents(): void {
    foreach ([BbTicketCreateForm::class, BbProjectCreateForm::class] as $class) {
      $markup = $this->renderDialog($class);
      self::assertSame(
        1,
        substr_count($markup, $this->dialogSelector()),
        $class . ' renders exactly one dialog hull.',
      );
      self::assertSame(
        1,
        substr_count($markup, $this->surfaceSelector()),
        $class . ' renders exactly one surface.',
      );
      self::assertSame(
        1,
        substr_count($markup, 'name="form_build_id"'),
        $class . ' emits its hidden inputs exactly once — a second copy breaks the next submit.',
      );
      self::assertSame(
        1,
        substr_count($markup, 'data-dialog-close'),
        $class . ' renders exactly one close control — the ruling\'s first half.',
      );
      self::assertMatchesRegularExpression(
        '#dialog__actions#',
        $markup,
        $class . ' renders its action row in the hull\'s own footer.',
      );
      self::assertStringNotContainsString(
        'form__actions',
        $markup,
        $class . ' left its action row in the body, where the other dialog does not have it.',
      );
    }
  }

  /**
   * NEITHER create dialog composes a hull of its own.
   *
   * THE RULING STATED AS A STRUCTURAL FACT, and it is worth its own case
   * because the shared path is opted into by DOING NOTHING: there is no line
   * of code in either form for a reader to see, so a single assignment in
   * either one would take that surface off the shared hull while every
   * rendered count above still matched — the hull it composed for itself
   * would look the same. Asserted over both subjects from one list, so a
   * third create dialog is added to the list rather than forgotten.
   */
  public function testNeitherDialogComposesItsOwnHull(): void {
    foreach ([BbTicketCreateForm::class, BbProjectCreateForm::class] as $class) {
      self::assertArrayNotHasKey(
        WrappedRouteRenderer::OWN_HULL_PROPERTY,
        $this->container->get('form_builder')->getForm($class),
        $class . ' opted out of the hull the ruling put both dialogs on.',
      );
    }
  }

  /**
   * A widget renders independently of presenter-side control arrays.
   */
  public function testWidgetsRenderWithoutPresenterSideChannels(): void {
    $with_grammar = $this->renderDialog(BbProjectCreateForm::class);
    self::assertGreaterThan(
      0,
      substr_count($with_grammar, self::PICKER_SELECTOR),
      'The grammar puts pickers on the surface in the first place.',
    );

    $without = $this->renderDialog(BbProjectCreateForm::class, static function (array $form): array {
      foreach (Element::children($form) as $key) {
        unset($form[$key]['#picker']);
      }
      return $form;
    });

    self::assertSame(
      substr_count($with_grammar, self::PICKER_SELECTOR),
      substr_count($without, self::PICKER_SELECTOR),
      'Widgets render their own controls without presenter-side render arrays.',
    );
    self::assertStringContainsString(
      'What is this project called',
      $without,
      'The line controls still render, so the absence above is the pickers and not the whole surface.',
    );
  }

  /**
   * The component that carries a picked property, in the rendered markup.
   *
   * Measured, like the two selectors below: SDC writes `data-component-id` onto
   * every component it renders, so this is the component's identity in the
   * bytes rather than a class name that styling may rename.
   */
  private const PICKER_SELECTOR = 'data-component-id="bb_theme:option_picker"';

  /**
   * The dialog hull, as it appears in rendered markup.
   *
   * MEASURED AGAINST A REAL RENDER BEFORE IT WAS WRITTEN (plan Task 5 Step 1):
   * both dialogs answer with exactly one
   * `<dialog data-component-id="bb_theme:dialog" class="dialog …">`. The
   * attribute and not the class, because `dialog` is also the stem of
   * `dialog__body` and every other element of the hull, so a class-substring
   * count would answer six.
   */
  private function dialogSelector(): string {
    return 'data-component-id="bb_theme:dialog"';
  }

  /**
   * The surface, as it appears in rendered markup.
   *
   * Same measurement, same reason: one
   * `<div data-component-id="bb_theme:form" class="form …">` per dialog, and
   * `form` is the stem of `form__lead`, `form__properties` and `form__actions`.
   */
  private function surfaceSelector(): string {
    return 'data-component-id="bb_theme:form"';
  }

  /**
   * Renders one create dialog the way the wrapper format answers it.
   *
   * @param class-string $class
   *   The form class to build.
   * @param callable|null $mutate
   *   An optional transform applied to the built form before it is hulled,
   *   for the one case that measures the grammar by taking it away.
   *
   * @return string
   *   The rendered response body.
   */
  private function renderDialog(string $class, ?callable $mutate = NULL): string {
    $route_name = $class === BbTicketCreateForm::class
      ? 'entity.bb_ticket.create_form'
      : 'entity.bb_project.create_form';
    $request = Request::create('/?_wrapper_format=island_dialog&destination=%2Fbakers%2Fprojects');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $form = $this->container->get('form_builder')->getForm($class);
    if ($mutate !== NULL) {
      $form = $mutate($form);
    }
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $response = $this->container->get('main_content_renderer.island_dialog')
      ->renderResponse($form, $request, new RouteMatch($route_name, $route));

    $markup = (string) $response->getContent();
    // A render that produced no dialog at all would make every absence
    // assertion above pass vacuously.
    self::assertStringContainsString($this->dialogSelector(), $markup, $class . ' rendered a dialog.');

    return $markup;
  }

  /**
   * Creates a saved account holding exactly the given permissions.
   *
   * @param array<string> $permissions
   *   Permission machine names to grant.
   * @param string $name
   *   The account name.
   */
  private function newAccount(array $permissions, string $name): UserInterface {
    $account = $this->createUser($permissions, $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * The methods a class declares itself, beyond the ones it is allowed.
   *
   * @param class-string $class
   *   The class to reflect over.
   * @param array<string> $allowed
   *   The methods this class is allowed to declare.
   *
   * @return array<string>
   *   The declared methods outside the allowed set, sorted.
   */
  private function declaredBeyond(string $class, array $allowed): array {
    $reflection = new \ReflectionClass($class);
    $from_traits = [];
    foreach ($reflection->getTraits() as $trait) {
      foreach ($trait->getMethods() as $method) {
        $from_traits[] = $method->getName();
      }
    }

    $declared = [];
    foreach ($reflection->getMethods() as $method) {
      $name = $method->getName();
      if ($method->getDeclaringClass()->getName() !== $class
        || in_array($name, $from_traits, TRUE)
        || in_array($name, $allowed, TRUE)) {
        continue;
      }
      $declared[] = $name;
    }
    sort($declared);

    return $declared;
  }

  /**
   * The module's own template files whose source names a given string.
   *
   * @param string $module
   *   The module whose `templates/` directory is walked.
   * @param string $needle
   *   The string to look for — an SDC component id, here.
   *
   * @return array<string>
   *   The matching file names, sorted, without their directory.
   */
  private function templatesContaining(string $module, string $needle): array {
    $directory = $this->container->get('extension.list.module')->getPath($module);
    $found = [];
    foreach (glob(DRUPAL_ROOT . '/' . $directory . '/templates/*.html.twig') ?: [] as $path) {
      if (str_contains((string) file_get_contents($path), $needle)) {
        $found[] = basename($path);
      }
    }
    sort($found);

    return $found;
  }

}
