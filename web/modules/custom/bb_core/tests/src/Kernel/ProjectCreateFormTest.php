<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Entity\Display\EntityFormDisplayInterface;
use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Render\Element;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Form\BbProjectCreateForm;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidgetInterface;
use Drupal\island\Render\WrappedRouteRenderer;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The create-project dialog writes, and a rejected write costs nothing.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectCreateFormTest extends KernelTestBase {

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
   * The group every project in this suite is created in.
   */
  private BbGroupInterface $group;

  /**
   * The team every valid submit in this suite names.
   */
  private BbTeamInterface $team;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      // `bb_workspace` because the dialog's own urls are workspace-prefixed:
      // `Url` resolution runs BbWorkspacePathProcessor, which loads a
      // workspace. An empty table is enough — the path simply does not get
      // rewritten — but no table at all is a fatal.
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_workspace',
      'bb_team', 'bb_environment', 'bb_ticket', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    // The two files this suite cannot do without:
    // `core.entity_form_mode.bb_project.settings` from `bb_core`'s own
    // config, and `core.entity_form_display.bb_project.bb_project.settings`
    // from the recipe, which IS the dialog — the fields, their widgets, their
    // regions and the map of everything a client may not send.
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    $this->installShippedFormDisplays();
    // Uid 1 bypasses every access check, so it must not be an actor.
    $this->newAccount([], 'uid1-dummy');

    $this->setCurrentUser($this->newAccount(
      ['administer bakers', 'create bb_project'],
      'project-creator',
    ));

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Create-form workspace']);
    $workspace->save();

    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'Create-form group', 'workspace_id' => $workspace->id()]);
    $group->save();
    self::assertInstanceOf(BbGroupInterface::class, $group);
    $this->group = $group;

    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Create-form team']);
    $team->save();
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $this->team = $team;
  }

  /**
   * Spec D4 and AC5: the surface is exactly five fields, in grammar order.
   */
  public function testTheDialogSubmitsExactlyFiveFields(): void {
    $display = $this->createDisplay();
    $components = $display->getComponents();
    uasort($components, static fn (array $a, array $b): int => $a['weight'] <=> $b['weight']);

    self::assertSame(
      ['group_id', 'teams', 'name', 'description', 'image', 'repository', 'owner_user_id', 'env_vars'],
      array_keys($components),
    );

    $hidden = $display->get('hidden');
    self::assertIsArray($hidden);
    foreach (['key', 'next_number', 'environments'] as $absent) {
      self::assertArrayHasKey(
        $absent,
        $hidden,
        sprintf('"%s" is hidden by name, which is what keeps it off the wire.', $absent),
      );
      self::assertNull(
        $display->getComponent($absent),
        sprintf('"%s" has no widget on the create display.', $absent),
      );
    }
  }

  /**
   * Spec D4: each field renders into the region the scene puts it in.
   *
   * Read off the BUILT form rather than off the config, because the region a
   * field ends up in is the widget setting resolved through
   * the shared create form — and for `name` and `repository` it is not a
   * setting at all: a non-picker widget states no region and the grammar
   * defaults it to `lines`. That default is what makes `repository` a
   * borderless line without `BbRepoWidget` knowing the grammar exists
   * (spec D6).
   */
  public function testEachFieldLandsInTheRegionTheSceneGivesIt(): void {
    $form = $this->buildCreateForm();

    self::assertSame([
      'group_id' => PickerWidgetInterface::REGION_LEAD,
      'teams' => PickerWidgetInterface::REGION_PILLS,
      'name' => PickerWidgetInterface::REGION_LINES,
      'description' => PickerWidgetInterface::REGION_LINES,
      'image' => PickerWidgetInterface::REGION_LINES,
      'repository' => PickerWidgetInterface::REGION_LINES,
      'owner_user_id' => PickerWidgetInterface::REGION_PILLS,
      'env_vars' => PickerWidgetInterface::REGION_LINES,
    ], $this->regionsOfBuiltForm($form));

    self::assertFalse($form['env_vars']['#access']);
    self::assertFalse($form['repository']['widget'][0]['branch_convention']['#access']);
    self::assertTrue($form['repository']['widget'][0]['default_branch']['#access'] ?? TRUE);
  }

  /**
   * Spec D5, amended (`9d718d2a`): the create dialog offers a default branch.
   *
   * The access assertion above proves the input renders; this proves the
   * typed value SURVIVES the create path — `copyFormValuesToEntity()` is
   * where a newly visible input would otherwise be dropped silently.
   */
  public function testSubmittedDefaultBranchSurvivesTheCreate(): void {
    $project = $this->submit([
      'name' => $this->line('Branch-naming project'),
      'repository' => [
        [
          'url' => 'https://gitlab.example.com/bakers/branch-naming.git',
          'default_branch' => 'develop',
        ],
      ],
    ]);

    self::assertSame(
      'develop',
      $project->get('repository')->first()?->get('default_branch')->getValue(),
    );
  }

  /**
   * AC1: a valid submit stores the project, and the server derives its key.
   *
   * The key is a HAND-DERIVED literal and not a second call to
   * `defaultKey()`: `Designbook` slugs to `designbook`, which uppercases to
   * ten characters exactly. Reading it back off the stored entity is what
   * proves the derivation survived the write rather than only the build.
   */
  public function testValidSubmitCreatesTheProject(): void {
    $project = $this->submit([
      'name' => $this->line('Designbook'),
      'repository' => [['url' => 'https://gitlab.example.com/bakers/designbook.git']],
    ]);

    self::assertSame('Designbook', $project->getName());
    self::assertSame('DESIGNBOOK', $project->getKey());
    self::assertSame($this->group->id(), $project->get('group_id')->target_id);
    self::assertSame([$this->team->id()], array_column($project->get('teams')->getValue(), 'target_id'));
    self::assertSame(
      'https://gitlab.example.com/bakers/designbook.git',
      $project->get('repository')->first()?->get('url')->getValue(),
    );
    self::assertSame(
      (int) $this->container->get('current_user')->id(),
      (int) $project->get('owner_user_id')->target_id,
      'The acting account owns what it created.',
    );
  }

  /**
   * Two projects created through this dialog get two different keys.
   *
   * THE CONSEQUENCE OF THE BUG ABOVE, AND THE REASON IT IS NOT COSMETIC. The
   * default-value callback runs when the form CREATES its empty entity, so
   * `key` was computed from an empty `name` and every project filed through
   * this dialog came back `bakers.build` — the fallback. `key` carries a
   * `UniqueField` constraint, so the SECOND one is then refused, blaming a
   * field this surface does not show and an operator cannot fix. Asserting a
   * distinct pair rather than one derived value is what makes a fix that
   * hardcodes a string fail too.
   */
  public function testEachProjectGetsItsOwnDerivedKey(): void {
    $first = $this->submit(['name' => $this->line('Designbook')]);
    $second = $this->submit(['name' => $this->line('Conductor')]);

    self::assertSame('DESIGNBOOK', $first->getKey());
    self::assertSame('CONDUCTOR', $second->getKey());
  }

  /**
   * AC2, spec D5: a teamless submit is refused, and the message names Teams.
   *
   * THE REFUSAL IS THE ENTITY'S AND THE WORDING IS THIS PRODUCT'S.
   * `bb_project.teams` is `setRequired(TRUE)`, which on a multi-value field
   * puts `NotNull` on the item list, so `ContentEntityForm::validateForm()`
   * refuses an empty one with no code of ours. What IS ours is that the
   * sentence carries the field's human name:
   * `WidgetBase::flagErrors()` reports the raw constraint message — "This
   * value should not be null." — with no field and no context, which is what
   * an operator was shown before BB-420 Task 13.
   *
   * The error KEY stays the field name, which is what makes it field-level.
   */
  public function testMissingTeamRefusalReachesTheFieldAndMessenger(): void {
    $state = $this->submitExpectingRefusal([
      'name' => $this->line('Teamless'),
      'teams' => [],
    ]);

    self::assertArrayHasKey('teams', $state->getErrors());
    self::assertSame('Teams field is required.', (string) $state->getErrors()['teams']);
    self::assertSame('Teams field is required.', (string) $state->getCompleteForm()['teams']['widget']['#errors']);
    self::assertContains('Teams field is required.', array_map('strval', $this->container->get('messenger')->messagesByType('error')));
    self::assertStringContainsString('data-option-picker-name="teams"', $this->renderControl($state, 'teams'));
  }

  /**
   * AC3, second half: a groupless project is refused, and never created.
   *
   * The inline-create half of AC3 is deliberately unmet (spec D7); this is the
   * half that holds. `group_id` is entity-required, so the refusal is the
   * entity's for the same reason `teams` is.
   */
  public function testSubmittingWithoutGroupIsRefusedAgainstTheGroupField(): void {
    $state = $this->submitExpectingRefusal([
      'name' => $this->line('Groupless'),
      'group_id' => NULL,
    ]);

    self::assertArrayHasKey('group_id', $state->getErrors());
    self::assertSame(0, $this->projectCount(), 'A refused submit wrote nothing.');
  }

  /**
   * AC4: a rejected write blames the field and keeps every typed value.
   */
  public function testRejectedWriteKeepsEveryTypedValue(): void {
    $state = $this->submitExpectingRefusal([
      'name' => $this->line('Typed and not thrown away'),
      'repository' => [['url' => 'https://gitlab.example.com/bakers/kept.git']],
      'teams' => [],
    ]);

    self::assertArrayHasKey('teams', $state->getErrors());
    self::assertSame('Typed and not thrown away', $this->typedValue($state, 'name'));
    self::assertSame('https://gitlab.example.com/bakers/kept.git', $this->typedValue($state, 'repository'));
  }

  /**
   * The dialog form posts into itself, on core's own htmx form shape.
   */
  public function testTheDialogFormPostsIntoItselfAndUpdatesTheHullsMessages(): void {
    $request = Request::create('/bakers/project/create?_wrapper_format=island_dialog');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $form = $this->buildCreateForm();
    $attributes = $form['#attributes'] ?? [];

    self::assertStringEndsWith('_form', BbProjectCreateForm::FORM_ID);
    self::assertStringEndsWith(
      '-form',
      (string) $form['#id'],
      'Core keys its htmx-form handling on this suffix and on nothing else.',
    );
    self::assertSame('this', (string) ($attributes['data-hx-target'] ?? ''));
    self::assertStringStartsWith('outerHTML', (string) ($attributes['data-hx-swap'] ?? ''));
    self::assertSame('form#' . $form['#id'], (string) ($attributes['data-hx-select'] ?? ''));
    self::assertSame(
      '#' . WrappedRouteRenderer::MESSAGE_REGION_ID . ':innerHTML',
      (string) ($attributes['data-hx-select-oob'] ?? ''),
      'The hull’s message slot is outside the form, so it has to be swapped out of band.',
    );
  }

  /**
   * A forged POST that omits the owner is REFUSED, not crashed into.
   */
  public function testForgedPostWithoutAnOwnerIsRefusedAgainstTheOwnerField(): void {
    $form_state = new FormState();
    $response = $this->postInDialogFormat([
      'group_id' => (string) $this->group->id(),
      'name' => $this->line('Forged without an owner'),
      'teams' => [(string) $this->team->id()],
    ], $form_state);

    self::assertNull($response, 'A refusal re-renders the dialog rather than landing.');
    self::assertArrayHasKey('owner_user_id', $form_state->getErrors());
    self::assertSame(
      'Owner field is required.',
      (string) $form_state->getErrors()['owner_user_id'],
      'The refusal names the field the way the surface does.',
    );
    self::assertSame(0, $this->projectCount(), 'A refused submit wrote nothing.');
  }

  /**
   * Spec D7: no picker on this surface offers a create row or a clear row.
   *
   * TWO ABSENCES WITH TWO DIFFERENT MEANINGS, asserted together because the
   * display states them together. An empty `create_label` is how
   * `PickerWidget::defaultSettings()` says a field offers no inline create —
   * which is AC3's unmet half, pinned as an absence so a later ticket that
   * wires it has to change this test rather than widen the surface quietly.
   * An empty `clear_label` is how a field that must always hold a value says
   * so, and for `group_id` and `teams` it is the surface's half of the same
   * rule the entity's own `NotNull` enforces.
   */
  public function testNoPickerOffersCreateOrClearRow(): void {
    $display = $this->createDisplay();
    foreach (['group_id', 'teams', 'owner_user_id'] as $name) {
      $widget = $display->getRenderer($name);
      self::assertInstanceOf(PickerWidgetInterface::class, $widget);
      self::assertSame('', $widget->getSetting('create_label'), $name . ' offers no create row.');
      self::assertSame('', $widget->getSetting('clear_label'), $name . ' offers no clear row.');
      self::assertNull($widget->getSetting('gate_message'), $name . ' gates nothing.');
    }
  }

  /**
   * Spec D2: this form opts into the generic hull by NOT opting out.
   *
   * INVISIBLE IN THE SOURCE, WHICH IS WHY IT IS PINNED. `WrappedRouteRenderer`
   * wraps any main content that does not set its own-hull property to FALSE,
   * so the project dialog gets `bb_theme:dialog` — the component the scene
   * names — for free, and the dialog's title is the route's `_title`. A
   * later edit that copied `BbTicketCreateForm`'s two `buildForm()` lines
   * across would render a dialog inside a dialog, and nothing else in this
   * suite would notice.
   */
  public function testTheDialogLetsTheIslandModuleBuildItsHull(): void {
    self::assertArrayNotHasKey(
      WrappedRouteRenderer::OWN_HULL_PROPERTY,
      $this->buildCreateForm(),
    );
  }

  /**
   * A denied account is offered NO submit, not a dead one.
   */
  public function testDeniedAccountIsOfferedNoSubmit(): void {
    $this->setCurrentUser($this->newAccount(['administer bakers'], 'project-reader'));

    $this->expectException(AccessDeniedHttpException::class);
    $this->buildCreateForm();
  }

  /**
   * Spec D7: a successful submit through the format authors its own landing.
   *
   * `FormBuilder::processForm()` calls `disableRedirect()` for every htmx
   * request, so a saved project would otherwise come back as a 200 re-render
   * of the same dialog — the overlay would still hold a create form for a
   * project that already exists. The empty body is what empties the overlay,
   * which is how this dialog closes, and `HX-Location` is what navigates the
   * client back to the screen the trigger was clicked on.
   */
  public function testSuccessfulDialogSubmitAuthorsItsOwnNavigation(): void {
    $response = $this->postInDialogFormat([
      'group_id' => (string) $this->group->id(),
      'name' => $this->line('Filed through the dialog format'),
      'teams' => [(string) $this->team->id()],
      // See {@see withFixtureDefaults()} for why the owner is always sent.
      'owner_user_id' => (string) $this->container->get('current_user')->id(),
    ]);

    self::assertInstanceOf(Response::class, $response);
    self::assertSame('', (string) $response->getContent(), 'The overlay is emptied, which closes the dialog.');
    self::assertSame('/bakers/projects', (string) $response->headers->get('HX-Location'));
    self::assertSame(1, $this->projectCount(), 'The project was written.');
  }

  /**
   * The regions the built form's own children declare, keyed by field.
   *
   * @param array<string, mixed> $form
   *   The built form.
   *
   * @return array<string, string>
   *   Every child that declared a region, in the order the grammar renders
   *   them.
   */
  private function regionsOfBuiltForm(array $form): array {
    $regions = [];
    foreach (Element::children($form, TRUE) as $key) {
      if (isset($form[$key]['#picker_region'])) {
        $regions[(string) $key] = (string) $form[$key]['#picker_region'];
      }
    }
    return $regions;
  }

  /**
   * A `lines` control's own submitted-and-repopulated value.
   *
   * @param \Drupal\Core\Form\FormStateInterface $state
   *   The form state.
   * @param string $field
   *   The field whose control is wanted.
   *
   * @return string|null
   *   The control's value, or NULL when no control claims the field.
   */
  private function typedValue(FormStateInterface $state, string $field): ?string {
    return $this->findLineValue($state->getCompleteForm(), $field);
  }

  /**
   * Walks a render array for the line control of one field.
   *
   * @param array<int|string, mixed> $element
   *   The element to walk.
   * @param string $field
   *   The field name the control carries.
   *
   * @return string|null
   *   The control's `#value`, or NULL.
   */
  private function findLineValue(array $element, string $field): ?string {
    if (($element['#parents'][0] ?? NULL) === $field && isset($element['#value']) && is_scalar($element['#value'])) {
      $value = $element['#value'] ?? NULL;
      return is_scalar($value) ? (string) $value : NULL;
    }
    foreach ($element as $key => $child) {
      if (is_array($child) && !(is_string($key) && str_starts_with($key, '#'))) {
        $found = $this->findLineValue($child, $field);
        if ($found !== NULL) {
          return $found;
        }
      }
    }
    return NULL;
  }

  /**
   * The submitted shape of a single-cardinality core widget's own value.
   *
   * `name` is core's `string_textfield`, which states no `multiple_values`, so
   * `WidgetBase::form()` nests a single-cardinality field's value under its
   * own delta — `name[0][value]`, the same shape any other Drupal entity form
   * submits a `string` field in.
   *
   * @param string $value
   *   The typed value.
   *
   * @return array<int, array<string, string>>
   *   The nested shape Form API expects at this field's own name.
   */
  private function line(string $value): array {
    return [['value' => $value]];
  }

  /**
   * One field's own control, rendered with no presenter template involved.
   *
   * @param \Drupal\Core\Form\FormStateInterface $state
   *   The state a refusal was registered on.
   * @param string $field
   *   The field whose control to render.
   */
  private function renderControl(FormStateInterface $state, string $field): string {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $control = $state->getCompleteForm()[$field]['widget'] ?? NULL;
    self::assertIsArray($control, sprintf('The "%s" widget rendered no control at all.', $field));

    return (string) $this->container->get('renderer')->renderInIsolation($control);
  }

  /**
   * The form display this dialog is built from.
   */
  private function createDisplay(): EntityFormDisplayInterface {
    $display = $this->container->get('entity_type.manager')
      ->getStorage('entity_form_display')
      ->load('bb_project.bb_project.settings');
    self::assertInstanceOf(
      EntityFormDisplayInterface::class,
      $display,
      'bb_core ships the settings form display.',
    );
    return $display;
  }

  /**
   * The create form, built the way a plain GET renders it.
   *
   * @return array<string, mixed>
   *   The form render array.
   */
  private function buildCreateForm(): array {
    return $this->container->get('form_builder')->getForm(BbProjectCreateForm::class);
  }

  /**
   * Submits a valid payload as a real request and returns the STORED project.
   *
   * @param array<string, mixed> $values
   *   Submitted values, merged over a group, a team and an owner the account
   *   may write.
   */
  private function submit(array $values): BbProjectInterface {
    $before = $this->projectCount();
    $response = $this->postInDialogFormat($this->withFixtureDefaults($values));
    self::assertInstanceOf(
      Response::class,
      $response,
      'A valid submit answers with the landing response rather than re-rendering.',
    );
    self::assertSame($before + 1, $this->projectCount(), 'The project was actually saved.');

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_project');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    $stored = $storage->loadUnchanged((int) reset($ids));
    self::assertInstanceOf(BbProjectInterface::class, $stored, 'The project round-trips through storage.');
    return $stored;
  }

  /**
   * Submits a payload expected to be refused and returns the form state.
   *
   * PROGRAMMATIC, unlike {@see submit()}, and the asymmetry is the point: a
   * refusal is registered by `validateForm()`, which a programmatic submission
   * runs in full — and only a programmatic submission hands the test the
   * `FormState` the refusal is registered on, together with the complete form
   * that refusal is answered with.
   *
   * @param array<string, mixed> $values
   *   Submitted values, merged over the fixture defaults.
   */
  private function submitExpectingRefusal(array $values): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues($this->withFixtureDefaults($values));
    $this->container->get('form_builder')->submitForm(BbProjectCreateForm::class, $form_state);
    return $form_state;
  }

  /**
   * The values every submit sends, so a case states only its own subject.
   *
   * @param array<string, mixed> $values
   *   The case's own values.
   *
   * @return array<string, mixed>
   *   Those values over the fixture's own.
   */
  private function withFixtureDefaults(array $values): array {
    return $values + [
      'group_id' => (string) $this->group->id(),
      'teams' => [(string) $this->team->id()],
      'owner_user_id' => (string) $this->container->get('current_user')->id(),
    ];
  }

  /**
   * Posts the dialog through the wrapper format and returns what it answers.
   *
   * @param array<string, mixed> $values
   *   The submitted values. `mixed` because a picker submits a flat string or
   *   list and a line submits the Field API shape.
   * @param \Drupal\Core\Form\FormStateInterface|null $form_state
   *   The state to drive the request on, for a case that needs to read the
   *   refusal a REAL request registered. A programmatic submission cannot
   *   answer that question for this form: it never runs the button-level
   *   `#submit` chain and therefore never reaches `save()`, which is exactly
   *   where an unsaveable payload declares itself.
   */
  private function postInDialogFormat(array $values, ?FormStateInterface $form_state = NULL): ?Response {
    $form_id = BbProjectCreateForm::FORM_ID;
    $request = Request::create(
      '/bakers/project/create?destination=%2Fbakers%2Fprojects&_wrapper_format=island_dialog',
      'POST',
      // The image widget's Upload button precedes the submit, so the submit
      // is named rather than left to first-button detection.
      $values + ['form_id' => $form_id, 'op' => 'Create project'],
    );
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $request->request->set(
      'form_token',
      $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64($form_id)),
    );

    $form_state ??= new FormState();
    try {
      $this->container->get('form_builder')->buildForm(BbProjectCreateForm::class, $form_state);
    }
    catch (EnforcedResponseException $exception) {
      return $exception->getResponse();
    }
    return NULL;
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
   * The number of bb_project rows that exist, access-unchecked.
   */
  private function projectCount(): int {
    return count($this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->getQuery()
      ->accessCheck(FALSE)
      ->execute());
  }

}
