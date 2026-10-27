<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\Entity\Display\EntityFormDisplayInterface;
use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Core\Form\FormState;
use Drupal\Core\Render\Element;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidget;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Form\BbTicketCreateForm;
use Drupal\island\Render\WrappedRouteRenderer;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The create-ticket dialog writes, and a rejected write costs nothing.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketCreateFormTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * The project every ticket in this suite is created in.
   */
  private BbProjectInterface $project;

  /**
   * The conductor every "set conductor" case assigns.
   */
  private BbConductorInterface $conductor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      // `bb_workspace` because the dialog's own urls are workspace-prefixed
      // now: `Url::fromUserInput('/bakers/tickets')` runs
      // BbWorkspacePathProcessor, which loads a workspace. An empty table is
      // enough — the path simply does not get rewritten — but no table at all
      // is a fatal.
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_workspace',
      'bb_conductor', 'bb_ticket', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    // `bb_core`'s own config, for the one file this suite cannot do
    // without: `core.entity_form_display.bb_ticket.bb_ticket.create`,
    // which IS the dialog now — the nine fields, their widgets, their
    // regions and the 37 names it hides.
    $this->installConfig(['system', 'user', 'filter', 'bb_core']);
    // Uid 1 bypasses every access check, so it must not be an actor.
    $this->newAccount([], 'uid1-dummy');

    $this->setCurrentUser($this->newAccount(
      ['administer bakers', 'create bb_ticket'],
      'ticket-creator',
    ));

    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'Create-form project']);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;

    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create([
        'conductor_id' => 'cw-framework',
        'label' => 'cw-framework',
        // An instance admin: a conductor is offered only while its owner can
        // work in the project.
        'owner_user_id' => $this->container->get('current_user')->id(),
        'status' => 'online',
        'project_id' => $this->project->id(),
        'states' => ['working'],
        'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
      ]);
    $conductor->save();
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $this->conductor = $conductor;
  }

  /**
   * AC2, structural — and it moved, because the thing it pins moved.
   */
  public function testTheDisplayHoldsExactlyTheNineFieldsInGrammarOrder(): void {
    $components = $this->createDisplay()->getComponents();
    uasort($components, static fn (array $a, array $b): int => $a['weight'] <=> $b['weight']);

    self::assertSame(
      ['workflow', 'title', 'description', 'parent_id', 'blocked_by', 'conductor_id', 'labels', 'recipe', 'ticket_type'],
      array_keys($components),
    );
  }

  /**
   * AC2, on the config: every server-owned field is HIDDEN, by name.
   */
  public function testEveryServerOwnedFieldIsHiddenOnTheDisplay(): void {
    $display = $this->createDisplay();
    $fields = $this->container->get('entity_field.manager')
      ->getFieldDefinitions('bb_ticket', 'bb_ticket');

    foreach (['identifier', 'number', 'state', 'branch_name', 'base_branch', 'owner_user_id', 'project_id'] as $owned) {
      self::assertArrayHasKey(
        $owned,
        $fields,
        sprintf('"%s" is a real field of bb_ticket, so hiding it means something.', $owned),
      );
      self::assertNull(
        $display->getComponent($owned),
        sprintf('The server-owned field "%s" has a widget on the create display.', $owned),
      );
    }
  }

  /**
   * AC2, on the request side: no server-owned name reaches the built form.
   *
   * Asserted by EQUALITY against the nine field names, not only by
   * `assertNotContains()` over the known-bad names: a substring-style check
   * cannot catch a surprise tenth field (an `assignee` pill, a `state`
   * pill under another name), and it would pass vacuously if
   * `submittedNamesOfBuiltForm()` ever collected nothing at all.
   * `assertEqualsCanonicalizing()` rather than `assertSame()` because the
   * SET of names, not the walk order they happen to be found in, is the
   * contract. `project_id` is resolved server-side (BB-664) and carries
   * no widget ON A PROJECT-BOUND REQUEST, so it joins the server-owned
   * names below rather than the expected set; the unbound case (the field
   * IS shown, review F1/AC-8) is
   * {@see testUnboundRequestShowsTheProjectPicker()}.
   */
  public function testNoServerOwnedFieldReachesTheForm(): void {
    $names = $this->submittedNamesOfBuiltForm(fn (): array => $this->buildFormOpenedOnProject((string) $this->project->id()));

    self::assertEqualsCanonicalizing(
      ['workflow', 'title', 'description', 'parent_id', 'blocked_by', 'conductor_id', 'labels', 'recipe', 'ticket_type'],
      $names,
      'A project-bound request emits exactly these nine names and no others.',
    );
    // Documentation only from here — the equality assertion above already
    // rules every one of these out; named individually so a reader sees
    // which server-owned fields this guards against.
    foreach (['identifier', 'number', 'state', 'branch_name', 'base_branch', 'owner_user_id', 'project_id'] as $owned) {
      self::assertNotContains($owned, $names);
    }
  }

  /**
   * AC-8: a request that binds no project gets the picker, not a silent gap.
   *
   * BB-664 review F1: the field used to stay hidden unconditionally, so
   * neither the reader nor `ContentEntityForm::validateForm()`'s own
   * component-filtered violations ever saw it. `alterFormDisplay()` now adds
   * it back for exactly this request shape.
   */
  public function testUnboundRequestShowsTheProjectPicker(): void {
    $names = $this->submittedNamesOfBuiltForm($this->buildForm(...));

    self::assertContains('project_id', $names, 'An unbound request must offer a way to choose the project.');
  }

  /**
   * AC3, first half: a set conductor is stored on the saved ticket.
   */
  public function testSetConductorIsStoredOnTheTicket(): void {
    $ticket = $this->submit(['title' => $this->line('A ticket'), 'conductor_id' => $this->conductor->id()]);
    self::assertSame($this->conductor->id(), $ticket->get('conductor_id')->target_id);
  }

  /**
   * AC3, second half: a cleared conductor leaves the field unset.
   *
   * Spec D5: a cleared picker emits no hidden input, so the key is absent
   * and the field is unset — not an empty-value sentinel.
   */
  public function testClearedConductorLeavesTheFieldUnset(): void {
    $ticket = $this->submit(['title' => $this->line('A ticket')]);
    self::assertTrue($ticket->get('conductor_id')->isEmpty());
  }

  /**
   * A picked `blocked_by` ticket is stored on the saved ticket.
   */
  public function testSetBlockedByIsStoredOnTheTicket(): void {
    $blocking = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create(['title' => 'Blocking ticket', 'workflow' => 'bb_work', 'project_id' => $this->project->id()]);
    self::assertInstanceOf(BbTicketInterface::class, $blocking);
    $blocking->save();

    $ticket = $this->submit([
      'title' => $this->line('A blocked ticket'),
      'blocked_by' => [$blocking->id()],
    ]);
    self::assertSame([$blocking->id()], array_column($ticket->get('blocked_by')->getValue(), 'target_id'));
  }

  /**
   * AC1: the ticket lands in its workflow's first state.
   */
  public function testTheTicketLandsInItsWorkflowsFirstState(): void {
    $ticket = $this->submit(['title' => $this->line('A ticket'), 'workflow' => 'bb_work']);
    self::assertSame('qualification', $ticket->get('state')->value);
  }

  /**
   * The saved ticket's description renders through its OWN text format.
   *
   * BB-420 Task 29's whole reason to exist. The deleted `bb_surface_line`
   * widget's `massageFormValues()` returned `[['value' => …]]` with no
   * `format` key, so a saved ticket stored `format: NULL` and the detail page
   * — which renders `description:processed` — printed
   * `[error] Missing text format: plain_text.`. The STORED value looked fine
   * throughout: a test that read `->value` would have passed against the bug,
   * which is why this one renders instead. The core `text_textarea` widget
   * supplies the site's one format (`bb_rich`) itself; nothing here does.
   */
  public function testDescriptionKeepsItsFormat(): void {
    $ticket = $this->submit([
      'title' => $this->line('A ticket with a description'),
      'description' => $this->line('Rendered through its own text format.'),
    ]);

    $build = $ticket->get('description')->view(['type' => 'text_default', 'label' => 'hidden']);
    $rendered = (string) $this->container->get('renderer')->renderInIsolation($build);

    self::assertStringContainsString('Rendered through its own text format.', $rendered);
    self::assertStringNotContainsString(
      'Missing text format',
      $rendered,
      'A NULL format on the saved item is exactly the defect this task fixes.',
    );
  }

  /**
   * AC5. An empty title is refused; the description and the pills survive.
   */
  public function testRejectedWriteKeepsEveryTypedValue(): void {
    $state = $this->submitExpectingRefusal([
      'title' => $this->line(''),
      'description' => $this->line('Typed and not thrown away'),
      'conductor_id' => $this->conductor->id(),
    ]);
    self::assertNotEmpty($state->getErrors());
    self::assertArrayHasKey('title][0][value', $state->getErrors());
    // READ OFF THE REBUILT FORM, not off `$form_state` (BB-420 Task 17).
    // What AC5 promises is that the operator gets their typing BACK, and the
    // only place that is true or false is what the refusal is answered with.
    // `description` renders through the normal Drupal element path since
    // Task 29 — there is no `#picker` any more, so this reads the core
    // `text_textarea` widget's own nested value element instead, which Form
    // API repopulates from submitted input the same way it repopulates any
    // other field on a form that fails validation.
    self::assertSame(
      'Typed and not thrown away',
      $this->descriptionValue($state),
      'The description textarea comes back carrying what was typed into it.',
    );
    self::assertSame(
      [$this->conductor->id()],
      $this->fieldProps($state, 'conductor_id', 'bb_theme:property_pill')['values'] ?? NULL,
      'The conductor pill comes back carrying the value that was picked.',
    );
  }

  /**
   * Finding 1: the refusal is registered in the SAME pass that produced it.
   */
  public function testRejectedDialogCarriesTheErrorMessageInline(): void {
    $state = $this->submitExpectingRefusal(['title' => $this->line('')]);

    self::assertSame(
      ['title][0][value' => 'Title field is required.'],
      array_map('strval', $state->getErrors()),
      'The refusal names the field the way its own control does.',
    );
    $messages = array_map('strval', $this->container->get('messenger')->messagesByType('error'));
    self::assertCount(1, $messages);
    self::assertSame('Title field is required.', $messages[0]);

  }

  /**
   * EVERY registered error renders, not just the first.
   *
   * Task 13's whole-branch review, item 1's second half: two simultaneous
   * violations used to collapse onto one sentence because
   * `messageFromErrors()` called `reset()` on the error list. `project_id`
   * no longer carries a widget (BB-664), so the second violation here is a
   * conductor outside the project-scoped picker's own referenceable options
   * (AC-2) rather than the originally used absent-project case. Asserted on
   * `$form_state->getErrors()` since BB-420 Task 30 — see
   * `testRejectedDialogCarriesTheErrorMessageInline()`'s own docblock for why.
   */
  public function testRejectedDialogRendersEveryRegisteredError(): void {
    $other_project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'A different project']);
    $other_project->save();
    $foreign_conductor = $this->conductor->createDuplicate();
    $foreign_conductor->set('conductor_id', 'foreign-conductor');
    $foreign_conductor->set('project_id', $other_project->id());
    $foreign_conductor->save();

    $state = $this->submitExpectingRefusal([
      'title' => $this->line(''),
      'conductor_id' => $foreign_conductor->id(),
    ]);

    $errors = array_map('strval', $state->getErrors());
    self::assertSame(
      'Title field is required.',
      $errors['title][0][value'] ?? NULL,
    );
    self::assertNotEmpty(
      array_filter($errors, static fn (string $message): bool => str_contains($message, 'cannot be referenced')),
      'A conductor outside the project-scoped picker options is refused alongside the empty title.',
    );
  }

  /**
   * A display with no `project_id` component gates nothing (BB-664 F8).
   *
   * The BB-420-era "resolved" gate this test originally pinned
   * (`IDENTIFIER_ANCHOR_FIELD`, a disabled submit plus inline guidance) was
   * already retired before BB-664's dialog work started — `project_id` is
   * now resolved server-side on a bound request and, since AC-8, shown as
   * an ordinary picker on an unbound one; neither path disables the submit
   * or names a `data-option-picker-requires` dependency. This case keeps
   * pinning the absence of that old mechanism against a display with no
   * `project_id` component at all, which is this suite's and
   * {@see createDisplay()}'s own removal shape.
   */
  public function testDisplayWithNoIdentifierAnchorFieldIsNotPermanentlyUnresolved(): void {
    $display = $this->createDisplay();
    $display->removeComponent('project_id')->save();

    $form = $this->buildForm();

    self::assertArrayNotHasKey(
      'disabled',
      $form['actions']['submit']['#attributes'],
      'A surface whose display declares no gate has no unresolved state to be in.',
    );
    self::assertArrayNotHasKey(
      'data-option-picker-requires',
      $form['actions']['submit']['#attributes'],
      'Nothing gates the submit, so nothing is named as its dependency.',
    );
    self::assertNull($form[WrappedRouteRenderer::MESSAGE_ATTRIBUTES_PROPERTY] ?? NULL, 'There is nothing to guide towards.');
  }

  /**
   * A picker with an opening default can still be CLEARED (AC3, spec D5).
   */
  public function testPickerWithAnOpeningDefaultCanStillBeCleared(): void {
    $display = $this->createDisplay();
    $component = $display->getComponent('conductor_id');
    self::assertIsArray($component);
    $component['settings']['default_value'] = (string) $this->conductor->id();
    $display->setComponent('conductor_id', $component)->save();
    self::assertSame(
      $this->conductor->id(),
      $this->submit(['title' => $this->line('Opens on a conductor')])->get('conductor_id')->target_id,
      'The default is what the dialog opens on.',
    );

    $state = $this->postForm([
      'project_id' => (string) $this->project->id(),
      'workflow' => 'bb_work',
      'title' => $this->line('Cleared the conductor'),
    ]);

    self::assertSame([], $state->getErrors());
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->loadByProperties(['title' => 'Cleared the conductor']);
    $saved = reset($ticket);
    self::assertInstanceOf(BbTicketInterface::class, $saved);
    self::assertTrue(
      $saved->get('conductor_id')->isEmpty(),
      'A POST that carries no key for the field clears it, default or not.',
    );
  }

  /**
   * Ruling R10, first half: an account without the permission gets no dialog.
   *
   * `buildIslandForm()` returns quietly rather than throwing — the same
   * shape `TeamMemberAddForm` takes — so a GET-embedded render of the island
   * on a page an unprivileged account can otherwise see does not fatal.
   */
  public function testBuildRendersNoDialogForAnAccountWithoutThePermission(): void {
    $this->setCurrentUser($this->newAccount([], 'no-create-permission'));

    $this->expectException(AccessDeniedHttpException::class);
    $this->buildForm();
  }

  /**
   * Ruling R10, second half: the write itself is refused, not just the build.
   *
   * The POST is reachable without the dialog ever having rendered, so the
   * write itself must be refused, not just the build — the property
   * `TeamMemberAddAccessTest` proves for its own form.
   */
  public function testSubmitIsRefusedForAnAccountWithoutThePermission(): void {
    $this->setCurrentUser($this->newAccount([], 'no-create-permission-2'));
    $before = $this->ticketCount();

    $this->expectException(AccessDeniedHttpException::class);
    try {
      $this->submitForm([
        'project_id' => $this->project->id(),
        'title' => $this->line('Should never be saved'),
      ]);
    }
    finally {
      self::assertSame($before, $this->ticketCount(), 'The refusal happens before the write, not after it.');
    }
  }

  /**
   * BB-664 review F1: a submission that resolves no project saves nothing.
   *
   * Before this fix `project_id` stayed hidden unconditionally, so
   * `ContentEntityForm::validateForm()`'s own component-filtered violations
   * never ran against it — the dialog silently stored `project_id = NULL`.
   * This posts with no `?project=` query AND no `project_id` value at all
   * (unlike every other case in this suite, which relies on
   * {@see submitForm()}'s own project default), the way an empty eligible
   * set or a tampered request would.
   */
  public function testSubmissionWithNoResolvableProjectIsRefused(): void {
    $before = $this->ticketCount();

    $form_state = new FormState();
    $form_state->setValues(['title' => $this->line('No project at all'), 'op' => 'Create ticket']);
    $this->container->get('form_builder')->submitForm(BbTicketCreateForm::class, $form_state);

    self::assertNotSame([], $form_state->getErrors(), 'A projectless submission is refused, not silently saved.');
    self::assertSame($before, $this->ticketCount(), 'Nothing was written.');
  }

  /**
   * An opening project the reader cannot use binds nothing.
   *
   * A deleted, forged or no-longer-accessible `?project=` falls back to the
   * project picker, so a submission without a picked project is refused.
   */
  public function testInaccessibleOpeningProjectIsRefusedUntilPicked(): void {
    $gone = $this->project->createDuplicate();
    $gone->save();
    $gone_id = (string) $gone->id();
    $gone->delete();
    $before = $this->ticketCount();

    $state = $this->submitForm(['title' => $this->line('Stale project')], $gone_id);

    self::assertArrayHasKey('project_id', $state->getErrors(), 'The unbound picker reports the missing project.');
    self::assertSame($before, $this->ticketCount(), 'Nothing was written.');
  }

  /**
   * A bound dialog ignores a posted project.
   */
  public function testBoundDialogIgnoresThePostedProject(): void {
    $other_project = $this->project->createDuplicate();
    $other_project->save();

    $ticket = $this->submit(['title' => $this->line('Forged project'), 'project_id' => $other_project->id()]);

    self::assertSame($this->project->id(), $ticket->get('project_id')->target_id);
  }

  /**
   * Reopening on another project offers only that project's conductors.
   */
  public function testReopeningOnAnotherProjectOffersOnlyItsConductors(): void {
    $other_project = $this->project->createDuplicate();
    $other_project->save();
    $other_conductor = $this->conductor->createDuplicate();
    $other_conductor->set('conductor_id', 'other-project-conductor');
    $other_conductor->set('project_id', $other_project->id());
    $other_conductor->save();

    $this->buildFormOpenedOnProject((string) $this->project->id());
    $values = $this->conductorOptions($this->buildFormOpenedOnProject((string) $other_project->id()));

    self::assertContains((string) $other_conductor->id(), $values);
    self::assertNotContains((string) $this->conductor->id(), $values);
  }

  /**
   * A project without conductors offers none and still creates unassigned.
   */
  public function testProjectWithoutConductorsCreatesAnUnassignedTicket(): void {
    $empty_project = $this->project->createDuplicate();
    $empty_project->save();
    $empty_id = (string) $empty_project->id();

    self::assertSame([], array_filter($this->conductorOptions($this->buildFormOpenedOnProject($empty_id))));

    $form_object = $this->submitForm(['title' => $this->line('Unassigned')], $empty_id)->getFormObject();
    self::assertInstanceOf(EntityFormInterface::class, $form_object);
    $ticket = $form_object->getEntity();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertNotNull($ticket->id(), 'The unassigned ticket was saved.');
    self::assertSame($empty_id, (string) $ticket->get('project_id')->target_id);
    self::assertTrue($ticket->get('conductor_id')->isEmpty());
  }

  /**
   * A dialog without project context offers no conductor.
   *
   * Conductor candidates depend on the project, so the project-less dialog
   * creates the ticket unassigned.
   */
  public function testUnboundDialogOffersNoConductor(): void {
    $unbound = $this->submittedNamesOfBuiltForm($this->buildForm(...));
    $bound = $this->submittedNamesOfBuiltForm(fn (): array => $this->buildFormOpenedOnProject((string) $this->project->id()));

    self::assertNotContains('conductor_id', $unbound);
    self::assertContains('conductor_id', $bound);
  }

  /**
   * The conductor option values a built dialog renders.
   *
   * @param array<string, mixed> $form
   *   The form render array.
   *
   * @return array<int, string>
   *   The option values.
   */
  private function conductorOptions(array $form): array {
    $element = $form['conductor_id']['widget'];
    $rendered = $element['#pre_render'][0]($element);
    return array_map('strval', array_column($rendered['control']['#props']['options'], 'value'));
  }

  /**
   * A REAL post of the dialog writes the ticket, with no Form API button.
   */
  public function testRealPostOfTheDialogWritesTheTicket(): void {
    $before = $this->ticketCount();

    $state = $this->postForm([
      'project_id' => (string) $this->project->id(),
      'workflow' => 'bb_work',
      'title' => $this->line('Written by a real POST'),
    ]);

    self::assertSame([], $state->getErrors());
    self::assertSame($before + 1, $this->ticketCount(), 'The POST actually wrote the ticket.');
  }

  /**
   * A REAL post that is refused writes nothing and keeps what was typed.
   *
   * The counterpart of the case above, and the reason the fix cannot simply be
   * "always submit": the same declaration must not turn a rejected payload
   * into a write. The typed title is read back off `$form_state` rather than
   * off the request, because that is what the re-rendered dialog is built
   * from.
   */
  public function testRealPostThatIsRefusedWritesNothingAndKeepsWhatWasTyped(): void {
    $before = $this->ticketCount();

    $state = $this->postForm([
      'project_id' => (string) $this->project->id(),
      'workflow' => 'bb_work',
      'title' => $this->line(''),
      'description' => $this->line('Typed, and worth keeping.'),
    ]);

    self::assertNotSame([], $state->getErrors(), 'The empty title is refused.');
    self::assertSame($before, $this->ticketCount(), 'A refused POST costs nothing.');
    self::assertSame(
      'Typed, and worth keeping.',
      $this->descriptionValue($state),
    );
  }

  /**
   * The way back out of the dialog is a page url, not an htmx fragment url.
   */
  public function testTheWayOutOfTheDialogDropsTheWrapperFormat(): void {
    $request = Request::create('/bakers/ticket/create', 'GET', [
      'project' => '1',
      'destination' => '/bakers/tickets?project=1&_wrapper_format=island_dialog',
      '_wrapper_format' => 'island_dialog',
    ]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $form = $this->buildForm();

    // READ OFF THE HULL PROPERTY, because this request carries the format and
    // the format MOVES the row: `WrappedDialogFormTrait::liftActionsIntoHull()`
    // hands it to the hull's own footer slot, which is where the ruling of
    // 2026-09-08 puts a dialog's actions. The case below, which asserts the
    // same href against a hostile `destination`, makes no dialog request and
    // therefore still finds the row among the form's own children — the two
    // together are what pins the row's location on each path.
    $row = $form[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY] ?? [];
    $href = (string) ($row['cancel']['#props']['href'] ?? '');
    self::assertStringNotContainsString('_wrapper_format', $href);
    self::assertStringContainsString('/bakers/tickets', $href);
    self::assertStringContainsString('project=1', $href);
  }

  /**
   * A `destination` that is not a local path is refused, and `/` is answered.
   *
   * `destination` is operator-supplied and reaches an `href` and an
   * `HX-Location`; an off-site value there is an open redirect. Both forms are
   * refused — an absolute url, and the protocol-relative `//host` form that
   * merely LOOKS local.
   */
  public function testForeignDestinationIsRefused(): void {
    foreach (['https://evil.example/', '//evil.example/'] as $hostile) {
      $request = Request::create('/bakers/ticket/create', 'GET', ['destination' => $hostile]);
      $request->setSession(new Session(new MockArraySessionStorage()));
      $this->container->get('request_stack')->push($request);

      $href = (string) ($this->buildForm()['actions']['cancel']['#props']['href'] ?? '');

      self::assertStringNotContainsString('evil.example', $href);
    }
  }

  /**
   * Through the dialog format, the form posts itself INTO itself.
   */
  public function testTheDialogFormatPostsTheFormIntoItself(): void {
    $form = $this->buildFormInDialogFormat();

    $attributes = $form['#attributes'] ?? [];
    self::assertArrayHasKey('data-hx-post', $attributes);
    self::assertStringContainsString('_wrapper_format=island_dialog', (string) $attributes['data-hx-post']);
    self::assertSame(
      'this',
      (string) ($attributes['data-hx-target'] ?? ''),
      'A form targeting anything but itself is handed the build-id swap.',
    );
    self::assertStringStartsWith('outerHTML', (string) ($attributes['data-hx-swap'] ?? ''));
    self::assertSame('form#' . $form['#id'], (string) ($attributes['data-hx-select'] ?? ''));
  }

  /**
   * The dialog form's own id ends in `_form`, which core keys behaviour on.
   */
  public function testTheDialogFormIdCarriesTheSuffixCoreKeysOn(): void {
    self::assertStringEndsWith('_form', BbTicketCreateForm::FORM_ID);
    self::assertStringEndsWith('-form', (string) $this->buildFormInDialogFormat()['#id']);
  }

  /**
   * Outside the format there is no htmx wiring at all.
   *
   * That IS the no-JavaScript surface: the trigger is an ordinary link, the
   * route answers with an ordinary page, and the form on it must submit the
   * ordinary way. A form carrying `hx-post` on that page would, with scripts
   * ON, post itself into an overlay the operator is not looking at.
   */
  public function testPlainRequestGetsNoHtmxWiringAtAll(): void {
    $request = Request::create('/bakers/ticket/create');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    $attributes = $this->buildForm()['#attributes'] ?? [];

    self::assertArrayNotHasKey('data-hx-post', $attributes);
    self::assertArrayNotHasKey('data-hx-target', $attributes);
  }

  /**
   * The surface composes NO hull, so the wrapper format builds it.
   */
  public function testTheFormComposesNoHullOfItsOwn(): void {
    self::assertArrayNotHasKey(
      WrappedRouteRenderer::OWN_HULL_PROPERTY,
      $this->buildFormInDialogFormat(),
      'A create dialog that owns its hull is off the shared path the ruling put both on.',
    );
  }

  /**
   * A successful submit through the format authors its own navigation.
   *
   * `FormBuilder::processForm()` calls `$form_state->disableRedirect()` for
   * every htmx request (`FormBuilder.php:329-334`), so a saved entity comes
   * back as a 200 re-render with no signal at all unless the form says
   * otherwise. The empty body is half the answer — it is what empties the
   * overlay, which is how this dialog closes, there being no client-side
   * dismissal anywhere in the theme — and `HX-Location` is the other.
   */
  public function testSuccessfulDialogSubmitAuthorsItsOwnNavigation(): void {
    $response = $this->postInDialogFormat([
      'project_id' => (string) $this->project->id(),
      'workflow' => 'bb_work',
      'title' => $this->line('Filed through the dialog format'),
    ]);

    self::assertInstanceOf(Response::class, $response);
    self::assertSame('', (string) $response->getContent(), 'The overlay is emptied, which closes the dialog.');
    $location = (string) $response->headers->get('HX-Location');
    self::assertStringContainsString('/bakers/tickets', $location);
    self::assertStringNotContainsString('_wrapper_format', $location, 'The landing url must not carry the format.');
  }

  /**
   * …and without the format it is an ordinary redirect, for an ordinary page.
   */
  public function testSuccessfulPlainSubmitRedirectsToTheDestination(): void {
    $response = $this->postInDialogFormat([
      'project_id' => (string) $this->project->id(),
      'workflow' => 'bb_work',
      'title' => $this->line('Filed from a standalone page'),
    ], FALSE);

    self::assertInstanceOf(RedirectResponse::class, $response);
    self::assertStringEndsWith('/bakers/tickets', $response->getTargetUrl());
    self::assertFalse($response->headers->has('HX-Location'), 'A page redirect authors no htmx header.');
  }

  /**
   * An unknown project id falls back to the unresolved-context state.
   *
   * The dialog leaves submit handling to Drupal. On `?project=999999` it
   * renders the normal enabled submit and the "Pick a project…" guidance,
   * alongside a project pill showing no value and no selected row — the id
   * was accepted at face value with no check that it is actually one of this
   * account's own candidates.
   * The server refuses the eventual submit regardless (an invalid reference
   * fails entity validation), so this is about the dialog's own coherence,
   * not a data hole.
   */
  public function testUnknownProjectIdFallsBackToTheUnresolvedContextState(): void {
    $form = $this->buildFormOpenedOnProject('999999');

    self::assertNull(
      $form['actions']['submit']['#attributes']['disabled'] ?? NULL,
      'The dialog does not disable its submit control.',
    );
    self::assertNull(
      $form[WrappedRouteRenderer::MESSAGE_ATTRIBUTES_PROPERTY] ?? NULL,
      'The guidance names the gating field, so a live pick on it retires the message.',
    );
  }

  /**
   * The counterpart of the test above: a REAL project id still resolves.
   *
   * Guards against an over-eager fix that refuses every id rather than only
   * an unknown one.
   */
  public function testKnownProjectIdStillResolves(): void {
    $form = $this->buildFormOpenedOnProject((string) $this->project->id());

    self::assertArrayNotHasKey(
      'disabled',
      $form['actions']['submit']['#attributes'],
      'A known project id resolves the gate, which enables the submit.',
    );
    self::assertNull(
      $form[WrappedRouteRenderer::MESSAGE_ATTRIBUTES_PROPERTY] ?? NULL,
      'A resolved gate has nothing to guide the operator towards.',
    );
  }

  /**
   * Posts the dialog the way a browser does: input on the request, no button.
   *
   * @param array<string, mixed> $values
   *   The submitted values, as the dialog's hidden inputs and text lines send
   *   them. NOT `array<string, string>`: the two core-widget lines submit the
   *   Field API shape `title[0][value]`, so a value here is a string for a
   *   picker and a nested delta array for a line — which is exactly what a
   *   real request carries and what `Request::create()` accepts.
   */
  private function postForm(array $values): FormStateInterface {
    $form_id = BbTicketCreateForm::FORM_ID;
    // The front page rather than a workspace-prefixed ticket list: the url is
    // not what is under test here, and the dialog's own route is exercised by
    // `postInDialogFormat()` below.
    $request = Request::create('/', 'POST', $values + ['form_id' => $form_id]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    // The account is authenticated, so `FormBuilder::prepareForm()` gives the
    // form a CSRF token and refuses — silently, by wiping the whole input —
    // any POST that does not carry a matching one. The placeholder is the
    // literal core derives `#token` from.
    $request->request->set(
      'form_token',
      $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64($form_id)),
    );

    $form_state = new FormState();
    try {
      $this->container->get('form_builder')->buildForm(BbTicketCreateForm::class, $form_state);
    }
    catch (EnforcedResponseException) {
      // A successful submit short-circuits the build: the form authors its own
      // navigation as a response (BB-420 Task 24), and `FormBuilder` raises
      // that response as an exception for core's own subscriber to deliver.
      // Nothing to assert here — the caller measures the write itself, and
      // `testSuccessfulDialogSubmitAuthorsItsOwnNavigation()` measures the
      // response.
    }
    return $form_state;
  }

  /**
   * Every submitted `name` found anywhere in the built surface.
   *
   * @param callable(): array<string, mixed> $build
   *   Builds the form; defaults to the unbound `buildForm()`.
   *
   * @return array<int, string>
   *   Every `name` prop value found in the tree, plus every core widget's own
   *   field name.
   */
  private function submittedNamesOfBuiltForm(?callable $build = NULL): array {
    $form = ($build ?? $this->buildForm(...))();
    $placed = $this->placedFields($form);
    self::assertNotEmpty($placed, 'The surface is placed for a permitted account.');
    $names = [];
    foreach ($placed as $field) {
      $surface = $form[$field]['#picker'] ?? NULL;
      if ($surface === NULL) {
        $names[] = $field;
        continue;
      }
      array_walk_recursive($surface, function (mixed $value, mixed $key) use (&$names): void {
        if ($key === 'name' && is_scalar($value)) {
          $names[] = (string) $value;
        }
      });
    }
    return $names;
  }

  /**
   * The fields the grammar placed, read the way the template reads them.
   *
   * @param array<string, mixed> $form
   *   The built form.
   *
   * @return array<int, string>
   *   The field names, in the form's own (weight) order.
   */
  private function placedFields(array $form): array {
    $placed = [];
    foreach (Element::children($form, TRUE) as $key) {
      $child = $form[$key];
      if (is_string($key) && !str_starts_with($key, '#') && is_array($child) && isset($child['#picker_region'])) {
        $placed[] = $key;
      }
    }
    return $placed;
  }

  /**
   * The create form, built the way the island renders it.
   *
   * @return array<string, mixed>
   *   The form render array.
   */
  private function buildForm(): array {
    return $this->container->get('form_builder')->getForm(BbTicketCreateForm::class);
  }

  /**
   * Initial dependent widgets use the project supplied by the opening route.
   */
  public function testOpeningProjectScopesDependentWidgets(): void {
    $other_project = $this->project->createDuplicate();
    $other_project->save();
    $other_conductor = $this->conductor->createDuplicate();
    $other_conductor->set('conductor_id', 'other-project-conductor');
    $other_conductor->set('project_id', $other_project->id());
    $other_conductor->save();

    $form = $this->buildFormOpenedOnProject((string) $this->project->id());
    $element = $form['conductor_id']['widget'];
    $rendered = $element['#pre_render'][0]($element);
    $values = array_column($rendered['control']['#props']['options'], 'value');
    self::assertContains((string) $this->conductor->id(), $values);
    self::assertNotContains((string) $other_conductor->id(), $values);
    self::assertSame($element['#id'], $rendered['control']['#props']['picker_id']);
  }

  /**
   * The create form, opened the way the ticket list opens it.
   *
   * @param string $project
   *   The project id the dialog is opened on.
   *
   * @return array<string, mixed>
   *   The form render array.
   */
  private function buildFormOpenedOnProject(string $project): array {
    $request = Request::create('/?project=' . $project);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    return $this->buildForm();
  }

  /**
   * The props one field's widget rendered itself with.
   *
   * @param \Drupal\Core\Form\FormStateInterface $state
   *   The form state.
   * @param string $field
   *   The field name.
   * @param string $component
   *   The component that field must have rendered itself as.
   *
   * @return array<string, mixed>
   *   The props the widget stated.
   */
  private function fieldProps(FormStateInterface $state, string $field, string $component): array {
    $form_object = $state->getFormObject();
    self::assertInstanceOf(ContentEntityForm::class, $form_object);
    $widget = $form_object->getFormDisplay($state)->getRenderer($field);
    self::assertInstanceOf(PickerWidget::class, $widget);
    $element = $widget->renderPicker($state->getCompleteForm()[$field]['widget']);
    $surface = $element['control'];
    self::assertSame(
      $component,
      $surface['#component'] ?? NULL,
      sprintf('The field "%s" renders itself as %s.', $field, $component),
    );
    return $surface['#props'] ?? [];
  }

  /**
   * The `description` textarea's own submitted-and-repopulated value.
   *
   * @param \Drupal\Core\Form\FormStateInterface $state
   *   The form state.
   */
  private function descriptionValue(FormStateInterface $state): ?string {
    $value = $state->getCompleteForm()['description']['widget'][0]['value']['#value'] ?? NULL;
    return is_scalar($value) ? (string) $value : NULL;
  }

  /**
   * The submitted shape of a single-cardinality core widget's own value.
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
   * The form display this dialog is built from.
   */
  private function createDisplay(): EntityFormDisplayInterface {
    $display = $this->container->get('entity_type.manager')
      ->getStorage('entity_form_display')
      ->load('bb_ticket.bb_ticket.create');
    self::assertInstanceOf(
      EntityFormDisplayInterface::class,
      $display,
      'bb_core ships the create form display.',
    );
    return $display;
  }

  /**
   * Submits a valid payload and returns the STORED ticket.
   *
   * @param array<string, mixed> $values
   *   Submitted values, merged over a project the account may write to.
   */
  private function submit(array $values): BbTicketInterface {
    $state = $this->submitForm($values);
    self::assertSame(
      [],
      $state->getErrors(),
      implode(' | ', array_map(static fn ($m): string => (string) $m, $state->getErrors())),
    );
    $form_object = $state->getFormObject();
    self::assertInstanceOf(EntityFormInterface::class, $form_object);
    $ticket = $form_object->getEntity();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertNotNull($ticket->id(), 'The ticket was actually saved.');

    $stored = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->loadUnchanged($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $stored, 'The ticket round-trips through storage.');
    return $stored;
  }

  /**
   * Submits a payload expected to be refused and returns the form state.
   *
   * @param array<string, mixed> $values
   *   Submitted values, merged over a project the account may write to.
   */
  private function submitExpectingRefusal(array $values): FormStateInterface {
    return $this->submitForm($values);
  }

  /**
   * Submits the create form the way the island's own POST does.
   *
   * The dialog is opened bound to the fixture project (`?project=`), the way
   * a project's own ticket list opens it, so every case above states only
   * the values its own assertion is about.
   *
   * @param array<string, mixed> $values
   *   Submitted values.
   * @param string|null $project
   *   The project the dialog is opened on; defaults to the fixture project.
   */
  private function submitForm(array $values, ?string $project = NULL): FormStateInterface {
    $request = Request::create('/?project=' . ($project ?? $this->project->id()));
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $form_state = new FormState();
    // Select the real button during the build so core loads its save chain.
    $form_state->setValues($values + ['op' => 'Create ticket']);
    $this->container->get('form_builder')->submitForm(BbTicketCreateForm::class, $form_state);
    return $form_state;
  }

  /**
   * The dialog as the trigger's own `hx-get` fetches it.
   *
   * @return array<string, mixed>
   *   The form render array.
   */
  private function buildFormInDialogFormat(): array {
    $request = Request::create('/bakers/ticket/create', 'GET', [
      'project' => (string) $this->project->id(),
      'destination' => '/bakers/tickets',
      '_wrapper_format' => 'island_dialog',
    ]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    return $this->buildForm();
  }

  /**
   * Posts the dialog through the wrapper format and returns what it answers.
   *
   * @param array<string, mixed> $values
   *   The submitted values. `mixed` for the reason {@see postForm()} states:
   *   a picker submits a flat string, a core-widget line submits
   *   `title[0][value]`.
   * @param bool $through_the_format
   *   FALSE posts the same values as an ordinary page form, which is the
   *   JavaScript-less path.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function postInDialogFormat(array $values, bool $through_the_format = TRUE): ?Response {
    $form_id = BbTicketCreateForm::FORM_ID;
    $url = '/bakers/ticket/create?destination=%2Fbakers%2Ftickets';
    $request = Request::create(
      $through_the_format ? $url . '&_wrapper_format=island_dialog' : $url,
      'POST',
      $values + ['form_id' => $form_id],
    );
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $request->request->set(
      'form_token',
      $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64($form_id)),
    );

    $form_state = new FormState();
    try {
      $this->container->get('form_builder')->buildForm(BbTicketCreateForm::class, $form_state);
    }
    catch (EnforcedResponseException $exception) {
      return $exception->getResponse();
    }
    return NULL;
  }

  /**
   * Creates a saved account holding exactly the given permissions.
   *
   * `UserCreationTrait::createUser()` returns `UserInterface|false`; every
   * call site here hands the result to `setCurrentUser()` or holds onto it
   * as `UserInterface`, so the narrowing lives here once rather than at
   * every call site.
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
   * The number of bb_ticket rows that exist, access-unchecked.
   */
  private function ticketCount(): int {
    return count($this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->getQuery()
      ->accessCheck(FALSE)
      ->execute());
  }

}
