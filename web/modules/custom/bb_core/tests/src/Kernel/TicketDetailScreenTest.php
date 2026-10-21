<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Form\FormState;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Controller\BbTicketDetailController;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidgetInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\EntityFormSource;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The ticket-detail screen: one canvas, four regions, no tab row (BB-414 D1).
 *
 * THE SCREEN IS CONFIG: the full entity display owns the canvas and every
 * region. PHP sources provide the derived header and read-only row data;
 * one property entity form provides the configured editable widgets.
 *
 * The content island wraps this route's output. HTMX replaces the property
 * form after a save, preserving the rest of the detail screen.
 *
 * THE TAB ROW IS A REAL REMOVAL, MEASURED. `/bakers/ticket/BB-142` renders a
 * View/Edit local-tasks row today, because `DefaultEntityLocalTaskProvider` was
 * on `bb_ticket`'s handlers and the shell's `content` slot wraps
 * `local_tasks_block` beside `main_page_content`. The removal is scoped to the
 * ENTITY TYPE rather than to the shell: dropping the block from the layout
 * would take the team screen's six tabs with it, and those are there on
 * purpose. `testTheTeamScreenKeepsItsTabs()` is that scope, asserted rather
 * than asserted-about.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketDetailScreenTest extends KernelTestBase {

  use UserCreationTrait;
  use TicketNavigationViewsTrait;
  use RunsNavigationViewsTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'views',
    // BB-556 — 'file': bb_run's log_file/error_log_file base fields are
    // entity_reference targeting 'file', and the storage schema install
    // throws a FieldException resolving that target if the module is absent.
    'field', 'og', 'link', 'text', 'filter', 'file', 'image', 'markdown_easy',
    'bb_core', 'island',
    'bb_property_access_test',
    // THE BODY'S OWN STACK, AND IT IS HERE BECAUSE THE ZONES WERE NOT
    // MEASURED WITHOUT IT (BB-414). Every assertion in this class used to
    // stop at the canvas: `main` was the view builder's lazy build, so the
    // three zones the `full` display composes were never rendered and the Run
    // history zone could — and did — ship as a heading over nothing. These
    // five are what turns `main` from a promise into markup.
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
    // The `full` display places the Addons inline-card source beside the
    // inspector's `component`, so the module that provides it must be present.
    'serialization', 'jsonapi', 'jsonapi_resources', 'bb_inbox', 'bb_addon',
    // The inspector's Billing row is a bb_track source.
    'datetime', 'bb_track',
  ];

  /**
   * The canonical route the screen hangs off.
   */
  private const ROUTE = 'entity.bb_ticket.canonical';

  /**
   * The ambient workspace.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The ticket the screen renders.
   */
  private BbTicketInterface $ticket;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // bb_run is installed because BbTicket::preSave() queries runs; without
    // its schema every save here dies with a missing-table SQL error.
    $types = [
      'user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
      'bb_conductor', 'bb_term', 'bb_environment', 'bb_addon',
      'bb_track_account',
    ];
    foreach ($types as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'display_builder']);
    // UTC, AND NOT CONFIGURABLE PER ACCOUNT. The run row prints a wall-clock
    // string, so without a pinned zone the expected literal is a function of
    // whatever `system.date` the test host happens to carry.
    $this->config('system.date')
      ->set('timezone.default', 'UTC')
      ->set('timezone.user.configurable', FALSE)
      ->save();
    $this->installTicketDetailDisplays();
    // `administer bakers` IS THE RUN ROWS' PRECONDITION, and it is stated rather
    // than inherited from being uid 1. `bb_run` declares that as its
    // `admin_permission`, and `EntityReferenceEntityFormatter` filters its
    // referenced entities by `view` access — so a reader without it gets the
    // Run history heading over an empty zone, which is exactly the shape the
    // unbound `items` prop produced. Reproduced here: with no permission the
    // zone renders 0 rows and every assertion below fails for the wrong
    // reason. uid 1 does NOT bypass this in a kernel test.
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->installTicketNavigationViews();
    $this->installRunsNavigationViews();
    // bb_track's Time tab on a team needs the route of its view's display.
    $worklog = Yaml::decode((string) file_get_contents(dirname(DRUPAL_ROOT) . '/recipes/bakers/config/views.view.worklog.yml'));
    View::create([
      'id' => 'worklog',
      'label' => 'Worklog navigation route',
      'base_table' => 'users_field_data',
      'base_field' => 'uid',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => ['access' => ['type' => 'none']],
        ],
        'team' => [
          'id' => 'team',
          'display_title' => 'Team',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => ['path' => $worklog['display']['team']['display_options']['path']],
        ],
      ],
    ])->save();
    $this->container->get('router.builder')->rebuild();

    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $project = $storage->getStorage('bb_project')
      ->create(['name' => 'bakers.build Platform', 'workspace_id' => $workspace->id()]);
    $project->save();

    $ticket = $storage->getStorage('bb_ticket')->create([
      'workflow' => 'bb_feature',
      'title' => 'Add designbook entity view-mode for bb_ticket',
      'state' => 'coding',
      'project_id' => $project->id(),
      // THE DESCRIPTION IS NOT DECORATION HERE. The `full` display's About
      // zone feeds `rich-text.body` from `description:processed`. It USED TO BE
      // a REQUIRED prop, and an empty description dropped it and made SDC
      // refuse the whole render: measured on the live screen,
      // `/bakers/ticket/GL-E2E-DROPSH` answered 500 where `/bakers/ticket/BB-142`
      // answered 200. The test named for that case is below; the fixture states
      // a description so every OTHER assertion here measures the Run history
      // zone and not that.
      'description' => ['value' => 'Wire the ticket detail screen.', 'format' => 'bb_rich'],
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $this->ticket = $ticket;
  }

  /**
   * The canonical route renders the full entity view.
   */
  public function testCanonicalRouteRendersTheFullEntityView(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName(self::ROUTE);

    self::assertSame('bb_ticket.full', $route->getDefault('_entity_view'));
    self::assertFalse($route->hasDefault('_controller'));
    self::assertSame(
      BbTicketDetailController::class . '::title',
      $route->getDefault('_title_callback'),
    );
  }

  /**
   * The property operation builds configured widgets in one entity form.
   */
  public function testPropertyOperationUsesConfiguredEntityForm(): void {
    $definition = $this->container->get('entity_type.manager')->getDefinition('bb_ticket');
    self::assertTrue($definition->hasFormClasses() && $definition->getFormClass('property') !== NULL, 'The property operation must be available to the entity form builder.');
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_ticket', 'property');
    self::assertInstanceOf(ContentEntityForm::class, $form);
    $form->setEntity($this->ticket);
    $state = new FormState();
    $built = $form->buildForm([], $state);
    self::assertSame('property', $form->getFormDisplay($state)->getMode());
    foreach (['assignee_user_id', 'reviewers', 'conductor_id', 'priority', 'labels'] as $field) {
      self::assertNotNull($form->getFormDisplay($state)->getRenderer($field));
      self::assertSame('bb_picker', $form->getFormDisplay($state)->getRenderer($field)->getPluginId());
      self::assertArrayHasKey($field, $built);
    }
  }

  /**
   * A denied property keeps its place, but exposes neither input nor snapshot.
   */
  public function testPropertyFormRespectsPartialFieldAccess(): void {
    $this->ticket->set('branch_name', 'secret-branch')->set('priority', 2)->save();
    $this->container->get('state')->set('bb_property_access_test.denied', [
      'edit' => ['conductor_id'],
      'view' => ['priority', 'branch_name'],
    ]);
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $form = $this->container->get('entity.form_builder')->getForm($this->ticket, 'property');
    $snapshot = json_decode(base64_decode(strtr($form['property_baseline']['#default_value'], '-_', '+/')), TRUE);
    self::assertArrayNotHasKey('priority', $snapshot);
    $html = (string) $this->container->get('renderer')->renderInIsolation($form);
    self::assertStringNotContainsString('secret-branch', $html);
    self::assertStringNotContainsString('data-option-picker-name="conductor_id"', $html);
    self::assertStringNotContainsString('data-option-picker-name="priority"', $html);
    $previous = -1;
    // The form is the Properties block; Effort, Code and Relations are their
    // own read-only blocks beside it.
    foreach (['Stall', 'Assignee', 'Reviewers', 'Conductor', 'Priority', 'Labels', 'Created by'] as $label) {
      $position = strpos($html, $label);
      self::assertIsInt($position);
      self::assertGreaterThan($previous, $position);
      $previous = $position;
    }
  }

  /**
   * A rejected reference stays visible and submitted when retrying an edit.
   */
  public function testPropertyWidgetRetainsAnUnavailableAttempt(): void {
    $display = $this->container->get('entity_type.manager')->getStorage('entity_form_display')->load('bb_ticket.bb_ticket.property');
    $this->ticket->set('conductor_id', 2147483647);
    $widget = $display->getRenderer('conductor_id');
    self::assertInstanceOf(PickerWidgetInterface::class, $widget);
    $element = $widget->pickerElement($this->ticket->get('conductor_id'));
    self::assertSame(['2147483647'], $element['#props']['values']);
    self::assertSame('Unavailable selection (2147483647)', (string) $element['#props']['value_label']);
  }

  /**
   * The header stall surfaces follow blockers and the freeze age.
   *
   * "blocked" depends on other tickets, so both carry `bb_ticket_list`;
   * "frozen 5 min ago" is relative to now, so a frozen ticket is uncacheable.
   */
  public function testHeaderStallSurfacesFollowBlockersAndFreezeAge(): void {
    $this->ticket->setFrozen(TRUE)->save();
    foreach ($this->headerCacheMetadata() as $id => $cache) {
      self::assertContains('bb_ticket_list', $cache['tags'], $id);
      self::assertSame(0, $cache['max-age'], $id);
    }
  }

  /**
   * A ticket that is not frozen keeps the header cacheable.
   */
  public function testUnfrozenHeaderStaysCacheable(): void {
    foreach ($this->headerCacheMetadata() as $id => $cache) {
      self::assertContains('bb_ticket_list', $cache['tags'], $id);
      self::assertNotSame(0, $cache['max-age'], $id);
    }
  }

  /**
   * The `#cache` of both header sources for the fixture ticket.
   *
   * @return array<string, array<string, mixed>>
   *   Cache metadata keyed by source plugin id.
   */
  private function headerCacheMetadata(): array {
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $manager = $this->container->get('plugin.manager.ui_patterns_source');
    $metadata = [];
    foreach (['bb_ticket_detail_header', 'bb_page_header_description'] as $id) {
      $source = $manager->createInstance($id, []);
      self::assertInstanceOf(SourcePluginBase::class, $source);
      if ($id === 'bb_ticket_detail_header') {
        $source->setContextValue('entity', $this->ticket);
      }
      $metadata[$id] = $source->alterComponent([])['#cache'];
    }
    return $metadata;
  }

  /**
   * Entity-form placement preserves the form's restrictive cache metadata.
   */
  public function testEntityFormSourcePreservesFormCacheMetadata(): void {
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance('entity_form', [
      'settings' => ['operation' => 'property'],
    ]);
    self::assertInstanceOf(EntityFormSource::class, $source);
    $source->setContextValue('entity', $this->ticket);
    $build = $source->getPropValue();
    self::assertSame(0, $build['#cache']['max-age']);
    self::assertContains('route', $build['#cache']['contexts']);
    self::assertContains('user', $build['#cache']['contexts']);
    self::assertContains('og_membership_list', $build['#cache']['tags']);
  }

  /**
   * A previously built form validates against the current ticket revision.
   */
  public function testPropertyValidationPreservesChangesSinceTheFormWasBuilt(): void {
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $state = new FormState();
    $builder = $this->container->get('entity_type.manager')->getFormObject('bb_ticket', 'property');
    $builder->setEntity($this->ticket);
    $state->setFormObject($builder);
    $form = $builder->buildForm([], $state);
    $state->setValue('assignee_user_id', []);
    $this->ticket->set('title', 'Changed by another editor')->save();
    $this->ticket->set('assignee_user_id', 1)->save();
    $state->setValue('priority', ['2']);
    $state->setValue('title', 'Forged title');
    $state->setValue('state', 'done');
    $state->setValue('project_id', 2147483647);
    $state->setValue('time_estimate', 99999);
    $state->setValue('branch_name', 'forged-branch');
    $state->setValue('env_vars', 'FORGED=secret');
    $entity = $builder->buildEntity($form, $state);
    self::assertInstanceOf(BbTicketInterface::class, $entity);
    self::assertSame('Changed by another editor', $entity->label());
    self::assertSame('coding', $entity->get('state')->value);
    self::assertEquals(2, $entity->get('priority')->value);
    self::assertEquals(1, $entity->get('assignee_user_id')->target_id);
    self::assertEquals($this->ticket->get('project_id')->target_id, $entity->get('project_id')->target_id);
    foreach (['time_estimate', 'branch_name', 'env_vars'] as $field) {
      self::assertSame($this->ticket->get($field)->getValue(), $entity->get($field)->getValue());
    }
  }

  /**
   * The opening snapshot is bound to the ticket and current session.
   */
  public function testPropertySnapshotRejectsTamperingAndCrossTicketReplay(): void {
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $state = new FormState();
    $builder = $this->container->get('entity_type.manager')->getFormObject('bb_ticket', 'property');
    $builder->setEntity($this->ticket);
    $state->setFormObject($builder);
    $form = $builder->buildForm([], $state);
    $input = [
      'form_build_id' => $form['#build_id'],
      'property_baseline' => $form['property_baseline']['#default_value'],
      'property_signature' => $form['property_signature']['#default_value'],
    ];
    self::assertEqualsCanonicalizing(
      ['assignee_user_id', 'reviewers', 'conductor_id', 'priority', 'labels', 'parent_id', 'blocked_by'],
      array_keys(json_decode(base64_decode(strtr($input['property_baseline'], '-_', '+/')), TRUE)),
    );
    $this->container->get('request_stack')->getCurrentRequest()->setMethod('POST');
    $state->setUserInput($input);
    $state->setValue('priority', ['1']);
    $entity = $builder->buildEntity($form, $state);
    self::assertInstanceOf(BbTicketInterface::class, $entity);
    self::assertEquals(1, $entity->get('priority')->value);

    $state->setUserInput(['property_baseline' => '{}'] + $input);
    try {
      $builder->buildEntity($form, $state);
      self::fail('Tampered baseline was accepted.');
    }
    catch (AccessDeniedHttpException $exception) {
      self::assertSame(403, $exception->getStatusCode());
    }

    $other = $this->ticket->createDuplicate();
    $other->save();
    $builder->setEntity($other);
    $state->setUserInput($input);
    $this->expectException(AccessDeniedHttpException::class);
    $builder->buildEntity($form, $state);
  }

  /**
   * Display Builder places one property entity form inside the inspector.
   */
  public function testDisplayPlacesOnePropertyFormDirectlyInInspector(): void {
    $display = Yaml::decode((string) file_get_contents(
      dirname(DRUPAL_ROOT) . '/recipes/bakers/config/core.entity_view_display.bb_ticket.bb_ticket.full.yml',
    ));
    $canvas = $display['third_party_settings']['display_builder']['sources'][0];
    self::assertSame('bb_theme:canvas', $canvas['source']['component']['component_id']);

    $inspector = $canvas['source']['component']['slots']['inspector']['sources'][0];
    self::assertSame('bb_theme:inspector', $inspector['source']['component']['component_id']);
    $sources = $inspector['source']['component']['slots']['rows']['sources'];
    self::assertSame(
      [
        'ticket_reviews', 'ticket_properties', 'ticket_property_group_effort',
        'ticket_billing', 'ticket_property_group_code',
        'ticket_property_group_relations',
      ],
      array_column($sources, 'node_id'),
      'The Reviews block, then the editable Properties block, then the read-only blocks.',
    );
    self::assertTrue($inspector['source']['component']['props']['surface']['source']['value'], 'The rail is a surface.');
    self::assertSame(
      ['property'],
      array_map(
        static fn(array $source): string => (string) $source['source']['operation'],
        array_values(array_filter(
          $sources,
          static fn(array $source): bool => $source['source_id'] === 'entity_form',
        )),
      ),
    );
  }

  /**
   * The property route uses core's entity form controller and access gate.
   */
  public function testPropertyRouteUsesTheEntityFormOperation(): void {
    $route = $this->container->get('router.route_provider')->getRouteByName('entity.bb_ticket.property_form');
    self::assertSame('bb_ticket.property', $route->getDefault('_entity_form'));
    self::assertSame('bb_ticket.update', $route->getRequirement('_entity_access'));
  }

  /**
   * The add, edit and delete routes are untouched by the provider.
   *
   * The negative control for the assertion above: a provider that replaced
   * every route's defaults would satisfy it too, and the forms are not this
   * ticket's.
   */
  public function testTheFormRoutesAreLeftAlone(): void {
    $provider = $this->container->get('router.route_provider');
    foreach (['add_form', 'edit_form', 'delete_form'] as $rel) {
      $route = $provider->getRouteByName('entity.bb_ticket.' . $rel);
      self::assertNull(
        $route->getDefault('_controller'),
        sprintf('entity.bb_ticket.%s still renders its form.', $rel),
      );
      self::assertNotNull($route->getDefault('_entity_form'));
    }
  }

  /**
   * The full view mode composes the body's three zones in the canvas main.
   */
  public function testTheCanvasMainContainsTheTicketBody(): void {
    $main = $this->canvasSlots()['main'];

    self::assertCount(2, $this->findComponents($main, 'bb_theme:zone'));
    self::assertCount(1, $this->findComponents($main, 'bb_theme:collapsible'));
  }

  /**
   * The band fills exactly `flow`, `summary` and `links` — never `actions`.
   *
   * `summary-band` carried a fourth `actions` slot, declared for a transition
   * control that had been removed at a review gate and never refilled, and the
   * component deleted it. This screen is precisely the caller that must not ask
   * for it back.
   */
  public function testTheBandFillsItsThreeSlotsAndNoFourth(): void {
    $this->giveTheTicketItsLinks();
    $this->giveTheTicketItsSummary();
    $band = $this->band();

    self::assertSame(['flow', 'summary', 'links'], array_keys($band['#slots']));
  }

  /**
   * The flow is the ticket's OWN workflow, with its current state marked.
   *
   * Never a hard-coded list — the component says so of itself, and the reason
   * is that five workflows share this screen. A ticket on `bb_bug` runs
   * through `diagnose` where a feature runs through `spec`, and a literal list
   * here would show every bug the wrong chain.
   */
  public function testTheFlowIsTheTicketsWorkflowWithItsCurrentState(): void {
    $flow = $this->stateFlowOf($this->band());

    self::assertSame('bb_theme:state-flow', $flow['#component']);
    self::assertSame(
      ['qualification', 'spec', 'coding', 'review', 'done', 'cancelled'],
      $flow['#props']['states'],
      'The states are bb_feature\'s, in the order the workflow declares them.',
    );
    self::assertSame('coding', $flow['#props']['current']);
  }

  /**
   * The negative control: another workflow yields another chain.
   *
   * Without it the assertion above passes against a hard-coded feature chain,
   * which is the exact mistake the component warns about.
   */
  public function testAnotherWorkflowYieldsAnotherFlow(): void {
    $this->ticket->set('workflow', 'bb_bug')->set('state', 'diagnose');
    $this->ticket->save();
    $band = $this->band();

    $flow = $this->stateFlowOf($band);
    self::assertSame(
      ['qualification', 'diagnose', 'coding', 'review', 'done', 'cancelled'],
      $flow['#props']['states'],
    );
    self::assertSame('diagnose', $flow['#props']['current']);
  }

  /**
   * A ticket whose `state` was never set still renders, without a chain.
   *
   * `BbTicket::getState()` asserts its return type rather than returning
   * NULL, so the header source must inspect the field before asking for state.
   */
  public function testTicketWithoutStateStillRenders(): void {
    $this->ticket->set('state', NULL);
    $this->ticket->save();

    $flow = $this->band()['#slots']['flow'] ?? [];
    self::assertNotSame(
      'bb_theme:state-flow',
      $flow['#component'] ?? NULL,
      'No state, no chain — and no fatal.',
    );
    self::assertNotSame('', $this->renderScreen(), 'The screen still renders.');
  }

  /**
   * The summary is the newest `summary` comment, rendered in `teaser`.
   */
  public function testTheSummaryIsTheSummaryCommentInTheTeaserViewMode(): void {
    $summary = $this->giveTheTicketItsSummary();
    $slot = $this->band()['#slots']['summary'];

    self::assertSame('teaser', $slot['#view_mode'] ?? NULL);
    self::assertSame(
      $summary->id(),
      ($slot['#bb_comment'] ?? NULL)?->id(),
      'The band shows the LATEST summary and not merely a comment.',
    );
    $html = $this->renderScreen();
    self::assertStringContainsString('Open summary comment', $html);
    self::assertStringContainsString($summary->uuid(), $html);
    self::assertStringNotContainsString(
      'Open summary comment<span class="sr-only"> (opens in a new tab)</span>',
      $html,
    );
    self::assertStringNotContainsString('Previous:', $html);
    self::assertStringNotContainsString('Next:', $html);
  }

  /**
   * A ticket with no summary renders no summary region at all.
   *
   * The slot is ABSENT rather than empty, and both halves matter: SDC rejects
   * an empty array for a slot outright, and the component renders a region only
   * when its slot is filled — so a ticket with no summary yet gets a band of
   * two rather than a band with a gap where the summary would go.
   */
  public function testTheSummarySlotIsAbsentWithoutAnySummaryComment(): void {
    self::assertArrayNotHasKey('summary', $this->band()['#slots']);
  }

  /**
   * The band's links are the four grouped `link-group` components.
   */
  public function testTheBandsLinksAreTheGroupedLinkGroups(): void {
    $this->giveTheTicketItsLinks();
    $links = $this->band()['#slots']['links'];

    self::assertSame(
      ['Code', 'Test results', 'Try it yourself', 'More'],
      array_map(
        static fn(array $group): string => (string) $group['#props']['label'],
        $links,
      ),
    );
  }

  /**
   * A ticket with no links renders no group at all.
   */
  public function testTheLinksSlotIsAbsentWithoutLinks(): void {
    self::assertArrayNotHasKey('links', $this->band()['#slots']);
  }

  /**
   * Every row's label cell is a faint `text` cell — the rail's quiet column.
   */
  public function testEveryRowLabelIsFaintTextCell(): void {
    foreach ($this->inspectorItems() as $item) {
      self::assertSame('text', $item['cells']['label']['kind']);
      self::assertSame('faint', $item['cells']['label']['emphasis']);
    }
  }

  /**
   * The rail carries NO `state`, and nothing here offers to write it.
   *
   * It lives in the band's `state-flow`, read-only. The human removed the
   * transition surface at BB-335's second review gate and ruled it out again
   * for this ticket, so `state` is not an inline picker here — which is a
   * different statement from "the picker is disabled".
   */
  public function testStateIsNotAnInspectorRow(): void {
    $items = $this->inspectorItems();

    $labels = array_map(
      static fn(array $item): string => (string) $item['cells']['label']['value'],
      $items,
    );
    self::assertNotContains('State', $labels);

    foreach ($items as $item) {
      foreach ($item['cells'] as $cell) {
        self::assertNotSame(
          'meta-state',
          $cell['picker_id'] ?? NULL,
          'No cell in the rail is a state picker.',
        );
      }
    }
  }

  /**
   * Only the approved properties are editable, each with an empty choice.
   */
  public function testTheFourPropertiesAreIdentifiedAndClearable(): void {
    $display = $this->container->get('entity_type.manager')->getStorage('entity_form_display')->load('bb_ticket.bb_ticket.property');
    self::assertEqualsCanonicalizing(
      ['assignee_user_id', 'reviewers', 'conductor_id', 'priority', 'labels', 'parent_id', 'blocked_by'],
      array_keys($display->getComponents()),
    );
    self::assertEquals(
      [
        'assignee_user_id' => 'Unassigned',
        'reviewers' => 'No reviewers',
        'conductor_id' => 'No conductor',
        'priority' => 'No priority',
        'labels' => 'No labels',
        'parent_id' => 'No parent',
        'blocked_by' => 'Nothing blocking',
      ],
      array_map(
        static fn(array $component): string => $component['settings']['clear_label'],
        $display->getComponents(),
      ),
    );
  }

  /**
   * Read access does not expose inline editing without update access.
   */
  public function testInspectorPropertiesAreReadOnlyWithoutUpdateAccess(): void {
    $account = $this->createUser(['view bb_ticket']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->container->get('current_user')->setAccount($account);
    self::assertFalse($this->ticket->access('update'));
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance('entity_form', [
      'settings' => ['operation' => 'property'],
    ]);
    self::assertInstanceOf(EntityFormSource::class, $source);
    $source->setContextValue('entity', $this->ticket);
    $form = $source->getPropValue();
    self::assertSame('bb_theme:zone', $form['readonly']['#component']);
    self::assertCount(9, $form['readonly']['#slots']['content']['#props']['items']);
    self::assertFalse($form['actions']['submit']['#access']);
    $ordinary = $this->container->get('plugin.manager.ui_patterns_source')->createInstance('entity_form', [
      'settings' => ['operation' => 'default'],
    ]);
    self::assertInstanceOf(EntityFormSource::class, $ordinary);
    $ordinary->setContextValue('entity', $this->ticket);
    self::assertArrayNotHasKey('#form_id', $ordinary->getPropValue());
    foreach (array_slice($this->inspectorItems(), 0, 5) as $item) {
      $label = (string) ($item['cells']['label']['value'] ?? '');
      $kind = $item['cells']['value']['kind'] ?? NULL;
      self::assertSame($label === 'Stall' ? 'badge' : 'text', $kind, $label);
    }
    $html = $this->renderScreen();
    self::assertStringNotContainsString('data-form-save', $html);
    foreach (['Stall', 'Assignee', 'Reviewers', 'Conductor', 'Priority', 'Labels'] as $label) {
      self::assertStringContainsString($label, $html);
    }
    $this->container->get('request_stack')->getCurrentRequest()->setMethod('POST');
    $this->expectException(AccessDeniedHttpException::class);
    $source->getPropValue();
  }

  /**
   * Property forms obtain real options and defaults from their fields.
   */
  public function testPropertyFormsCarryRealOptionsAndCurrentValues(): void {
    $this->enrichTheTicket();
    $display = $this->container->get('entity_type.manager')->getStorage('entity_form_display')->load('bb_ticket.bb_ticket.property');
    $display->setComponent('priority', ['type' => 'options_select', 'weight' => 2])->save();
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $form = $this->container->get('entity.form_builder')->getForm($this->ticket, 'property');
    self::assertSame('select', $form['priority']['widget']['#type']);
    self::assertEquals([2], $form['priority']['widget']['#default_value']);
    self::assertArrayHasKey(1, $form['priority']['widget']['#options']);
    self::assertArrayHasKey(3, $form['priority']['widget']['#options']);
    foreach (['assignee_user_id', 'reviewers', 'conductor_id', 'labels'] as $field) {
      self::assertSame('bb_picker_value', $form[$field]['widget']['#type']);
      self::assertNotEmpty($form[$field]['widget']['#pre_render']);
    }
  }

  /**
   * The read-only rows carry the cell kind the scene fixes for each.
   */
  public function testTheReadOnlyRowsCarryTheScenesCellKinds(): void {
    $this->enrichTheTicket();
    $kinds = [];
    foreach ($this->inspectorItems() as $item) {
      $kinds[(string) $item['cells']['label']['value']] = $item['cells']['value']['kind'];
    }

    self::assertSame(
      [
        'Stall' => 'badge',
        'Created by' => 'text',
        'Estimate' => 'text',
        'Spent' => 'text',
        'Branch' => 'mono',
        'Base branch' => 'mono',
        'Environments' => 'text',
        'Env vars' => 'masked',
        'Parent' => 'badge',
        'Sub-tickets' => 'badge',
        'Blocked by' => 'badge',
        'Referenced' => 'badge',
      ],
      array_diff_key($kinds, array_flip(['Assignee', 'Reviewers', 'Conductor', 'Priority', 'Labels'])),
    );
  }

  /**
   * An EMPTY reference row degrades to a faint dash rather than a blank mono.
   *
   * The scene's long-handoff variant is where this is visible: the same four
   * rows that are `mono` on a filled ticket render as faint `text` em-dashes on
   * one with no parent, no children and no blockers.
   */
  public function testEmptyReferenceRowsRenderFaintDash(): void {
    $kinds = [];
    foreach ($this->inspectorItems() as $item) {
      $kinds[(string) $item['cells']['label']['value']] = $item['cells']['value'];
    }

    foreach (['Parent', 'Sub-tickets', 'Blocked by', 'Referenced', 'Environments'] as $row) {
      self::assertSame('text', $kinds[$row]['kind'], sprintf('%s degrades to text.', $row));
      self::assertSame('—', $kinds[$row]['value']);
      self::assertSame('faint', $kinds[$row]['emphasis']);
    }
  }

  /**
   * The `env_vars` row masks its value and badges its `origin`.
   *
   * MASKING IS STRUCTURAL, NOT COSMETIC: the value never enters the render
   * array at all, so there is nothing in the markup to reveal. The provenance
   * is carried by the badge's WORDS rather than by its colour — both quiet
   * tones render identically, which is the rule that a state must never be
   * conveyed by colour alone.
   */
  public function testEnvVarsRendersMaskedWithAnOriginBadge(): void {
    $this->enrichTheTicket();
    $cells = $this->inspectorRow('Env vars');

    self::assertSame('mono', $cells['key']['kind']);
    self::assertSame('BB_TARGET', $cells['key']['value']);
    self::assertSame('masked', $cells['value']['kind']);
    self::assertFalse($cells['value']['revealed']);
    self::assertArrayNotHasKey(
      'value',
      $cells['value'],
      'A masked cell carries NO value — masking is structural.',
    );
    self::assertSame('badge', $cells['origin']['kind']);
    self::assertSame('own', $cells['origin']['label']);
    self::assertSame('neutral', $cells['origin']['tone']);
  }

  /**
   * An env var the ticket inherits is badged `inherited`, not `own`.
   *
   * The negative control for the badge: without it, a builder that hard-coded
   * `own` would pass the assertion above.
   */
  public function testAnInheritedEnvVarIsBadgedInherited(): void {
    $parent = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'workflow' => 'bb_feature',
        'title' => 'Parent',
        'state' => 'coding',
        'project_id' => $this->ticket->get('project_id')->target_id,
        'env_vars' => "INHERITED_KEY=secret\n",
      ]);
    $parent->save();
    $this->ticket->set('parent_id', $parent->id());
    $this->ticket->save();

    $cells = $this->inspectorRow('Env vars');
    self::assertSame('INHERITED_KEY', $cells['key']['value']);
    self::assertSame('inherited', $cells['origin']['label']);
  }

  /**
   * The RENDERED rail shows the values — not merely keys that were set.
   *
   * Both display_builder and SDC drop an invalid prop SILENTLY, so an assertion
   * that a key exists in the build proves nothing about what a reader sees.
   * This one reads the markup.
   */
  public function testTheInspectorRendersItsValues(): void {
    $this->enrichTheTicket();
    $html = $this->renderScreen();

    foreach ([
      'Assignee', 'Reviewers', 'Conductor', 'Priority', 'Labels', 'Created by', 'Estimate', 'Spent',
      'Branch', 'Base branch', 'Environments', 'Env vars', 'Parent',
      'Sub-tickets', 'Blocked by', 'Referenced',
    ] as $label) {
      self::assertStringContainsString($label, $html, sprintf('The %s row is visible.', $label));
    }

    self::assertStringContainsString('feat/bb-142-detail', $html, 'The branch name renders.');
    self::assertStringContainsString('develop', $html, 'The base branch renders.');
    self::assertStringContainsString('BB_TARGET', $html, 'The env var KEY renders.');
    self::assertStringContainsString('Marieke van Dijk', $html, 'The assignee renders.');
    self::assertStringContainsString('4h', $html, 'The estimate renders humanised.');
    // THE PROVENANCE BADGE, READ OFF THE MARKUP AND NOT OFF THE CELL. The
    // origin cell is the one composed component in the rail, and SDC drops an
    // invalid prop set by refusing the whole render — so the word has to be
    // found inside `badge`'s own label span rather than anywhere in the page,
    // where `own` is a substring of half the theme's class names.
    self::assertStringContainsString(
      '<span data-badge-label>own</span>',
      $html,
      'The env-var provenance badge reaches the markup.',
    );
    // THE PICKERS' TRIGGERS, likewise: each names a real sprite, and an absent
    // or unknown icon is the one thing that stops a picker cell rendering.
    foreach (['assignee_user_id', 'reviewers', 'conductor_id', 'priority', 'labels'] as $field) {
      self::assertStringContainsString('data-option-picker-name="' . $field . '"', $html, sprintf('The %s widget renders.', $field));
    }
  }

  /**
   * The env var's VALUE never reaches the markup.
   *
   * The half of masking that a "renders the key" assertion cannot show.
   */
  public function testTheEnvVarValueNeverReachesTheMarkup(): void {
    $this->enrichTheTicket();

    self::assertStringNotContainsString(
      'super-secret-value',
      $this->renderScreen(),
      'A masked value is absent from the render array, so it cannot be in the markup.',
    );
  }

  /**
   * The screen renders NO tab row.
   *
   * Measured on the render path rather than on the handler list: the row is
   * drawn by `local_tasks_block` from whatever the local-task manager answers
   * for this route, so "no tasks on this route" is the statement that makes the
   * block render nothing.
   */
  public function testTheScreenHasNoTabRow(): void {
    self::assertSame(
      [],
      $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]),
      'The ticket screen has one face, so it shows no tab row.',
    );
  }

  /**
   * The removal is scoped: the team screen still has its six tabs.
   *
   * Without this the assertion above also passes against a shell that lost
   * `local_tasks_block` altogether, which would be a regression on every screen
   * that has faces on purpose.
   */
  public function testTheTeamScreenKeepsItsTabs(): void {
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')
      ->create(['name' => 'Platform Crew', 'workspace_id' => $this->workspace->id()]);
    $team->save();

    $tabs = $this->tabsOn('entity.bb_team.canonical', ['bb_team' => $team]);
    self::assertSame(
      [
        'entity.bb_team.canonical',
        'bb_core.bb_team.stats',
        'view.tickets.team_tickets',
        'view.runs.team_runs',
        'bb_core.bb_team.members',
        'view.worklog.team',
      ],
      $tabs,
      'A team is an entity place with five faces, plus Time, and keeps its tab row.',
    );
  }

  /**
   * The screen offers interventions, never workflow steps.
   *
   * The screen used to read state and write none (BB-335). AI agents drive
   * the workflow, so BB-588 adds only interventions: Cancel ticket in the
   * Properties footer, opening its confirmation in the overlay. No transition
   * button, state widget or state field reaches the markup.
   */
  public function testTheScreenOffersInterventionsNotWorkflowSteps(): void {
    $html = $this->renderScreen();

    self::assertSame(1, substr_count($html, 'data-form-save='), 'One form owns the property widgets.');
    self::assertMatchesRegularExpression('#data-hx-get="[^"]*/ticket/[^"/]+/action\?[^"]*_wrapper_format=island_dialog#', $html, 'Cancel ticket opens its confirmation dialog.');
    self::assertStringContainsString('>Freeze ticket<', $html);
    self::assertStringContainsString('>Cancel ticket<', $html);
    self::assertStringNotContainsString('bb_transition_', $html);
    self::assertDoesNotMatchRegularExpression('#\+ \d+ empty#', $html, 'Empty rows are left out, not counted.');
    self::assertStringNotContainsString('state_machine_buttons', $html);
    self::assertStringNotContainsString('name="state', $html);
    self::assertStringNotContainsString('/property/state', $html);
  }

  /**
   * A closed ticket renders every property read-only and offers no Cancel.
   */
  public function testClosedTicketsOfferNoEditing(): void {
    $this->ticket->set('state', 'done')->save();
    self::assertTrue($this->ticket->isClosed());
    foreach (['assignee_user_id', 'reviewers', 'conductor_id', 'priority', 'labels', 'title', 'description'] as $field) {
      self::assertFalse($this->ticket->get($field)->access('edit'), $field . ' is frozen.');
    }
    $html = $this->renderScreen();
    self::assertStringNotContainsString('data-option-picker-name', $html, 'No property renders as a picker.');
    self::assertStringNotContainsString('>Cancel ticket<', $html);
    self::assertStringNotContainsString('>Freeze ticket<', $html);
    self::assertStringNotContainsString('>Unfreeze ticket<', $html);
    self::assertStringNotContainsString('>More settings<', $html);
    self::assertStringContainsString('Properties', $html);
  }

  /**
   * Freeze and unfreeze sit in the inspector footer; a frozen ticket names why.
   */
  public function testFrozenTicketOffersUnfreezeAndNamesTheStall(): void {
    $html = $this->renderScreen();
    self::assertStringContainsString('>Freeze ticket<', $html);
    $idle = NULL;
    foreach ($this->propertiesItems() as $item) {
      if (($item['cells']['label']['value'] ?? NULL) === 'Stall') {
        $idle = $item['cells']['value']['label'] ?? NULL;
      }
    }
    self::assertSame('no conductor', $idle, 'A classified ticket with no conductor names that stall.');

    $this->ticket->setFrozen(TRUE)->save();
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->load($this->ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->ticket = $reloaded;
    $html = $this->renderScreen();
    self::assertStringContainsString('>Unfreeze ticket<', $html);
    self::assertStringNotContainsString('>Freeze ticket<', $html);
    self::assertStringContainsString('frozen', $html);
    $stall = NULL;
    foreach ($this->propertiesItems() as $item) {
      if (($item['cells']['label']['value'] ?? NULL) === 'Stall') {
        $stall = $item['cells']['value'];
      }
    }
    self::assertIsArray($stall);
    self::assertSame('badge', $stall['kind'] ?? NULL);
    self::assertSame('frozen', $stall['label'] ?? NULL);
    self::assertSame('wait', $stall['tone'] ?? NULL);
    self::assertNotSame('', $stall['suffix'] ?? '');
    self::assertMatchesRegularExpression(
      '/just now|.+ ago/',
      (string) ($stall['suffix'] ?? ''),
    );
  }

  /**
   * Read-only blocks leave empty rows out and link related tickets as chips.
   */
  public function testReadOnlyBlocksLeaveEmptyRowsOutAndLinkTickets(): void {
    $rows_service = $this->container->get('bb_core.ticket_inspector_rows');
    self::assertSame([], $rows_service->groupBlock('effort', $rows_service->build($this->ticket)), 'Nothing to show, no block.');

    $this->enrichTheTicket();
    $rows = $rows_service->build($this->ticket);
    $relations = $rows_service->groupBlock('relations', $rows);
    self::assertFalse($relations['#props']['open'], 'Relations are collapsed.');
    $chips = [];
    foreach ($relations['#slots']['content']['#props']['items'] as $item) {
      foreach ($item['cells'] as $key => $cell) {
        if ($key !== 'label') {
          self::assertSame('badge', $cell['kind']);
          self::assertStringContainsString('/ticket/', $cell['url']);
          $chips[] = $cell['label'];
        }
      }
    }
    self::assertNotEmpty($chips);
    self::assertTrue($rows_service->groupBlock('effort', $rows)['#props']['open'] ?? TRUE, 'Effort stays open when it has rows.');
  }

  /**
   * The header holds only the band; interventions close the inspector.
   *
   * BB-661: the Addons source is no longer a footer item next to
   * interventions — it moved to sit beside `component` as its own sibling
   * inside the `inspector` slot, rendering an always-visible inline card
   * rather than a button that used to open the retired overlay.
   */
  public function testInterventionsCloseTheInspector(): void {
    foreach (['/recipes/bakers/config/', '/config/sync/'] as $directory) {
      $display = Yaml::decode((string) file_get_contents(
        dirname(DRUPAL_ROOT) . $directory . 'core.entity_view_display.bb_ticket.bb_ticket.full.yml',
      ));
      $canvas = $display['third_party_settings']['display_builder']['sources'][0]['source']['component'];
      self::assertSame(['ticket_detail_header'], array_column($canvas['slots']['header']['sources'], 'node_id'), $directory);
      self::assertSame(['component', 'bb_ticket_addons'], array_column($canvas['slots']['inspector']['sources'], 'source_id'), $directory);
      $footer = $canvas['slots']['inspector']['sources'][0]['source']['component']['slots']['footer']['sources'];
      self::assertSame(['bb_ticket_interventions'], array_column($footer, 'source_id'), $directory);
    }
  }

  /**
   * A ticket with NO description renders, and renders NO About zone.
   *
   * THE CLASS OF GAP THIS EXISTS FOR: nothing asserted the empty case, so the
   * About zone shipped with a defect that only a real record could show. The
   * zone feeds the REQUIRED prop `rich-text.body` from
   * `field_property:bb_ticket:description:processed`, and ui_patterns
   * DELIBERATELY strips empty prop values before SDC sees them
   * (`ComponentElementBuilder::isPropValueEmpty()` — "empty value is not the
   * same as missing value"), so a required prop bound to a Drupal field is
   * unsatisfiable the moment the field is empty. SDC then threw from inside
   * Twig and the WHOLE SCREEN answered 500 — measured on
   * `/bakers/ticket/GL-E2E-DROPSH`, 500, against `/bakers/ticket/BB-142`, 200.
   *
   * Asserted on the RENDERED markup rather than on a prop, for the reason the
   * inspector's own render test gives twice over: the bug was invisible in the
   * build array, where the prop simply was not there.
   *
   * The zone is ABSENT, not empty. A heading over nothing is a promise the
   * screen does not keep, so `zone` renders no `<section>` at all when it has
   * neither content nor actions.
   */
  public function testTicketWithoutDescriptionRendersWithoutTheAboutZone(): void {
    $before = $this->renderScreen();
    self::assertStringContainsString(
      'About',
      $before,
      'The control: with a description, the About zone is on the screen.',
    );
    self::assertSame(
      2,
      substr_count($before, 'data-zone-heading'),
      'Two zones — About and the Properties block. Run history has no runs yet.',
    );

    $this->ticket->set('description', NULL);
    $this->ticket->save();
    $this->container->get('cache.render')->deleteAll();

    $html = $this->renderScreen();
    self::assertNotSame('', $html, 'The screen renders at all — this is the 500.');
    self::assertStringContainsString(
      'canvas',
      $html,
      'The screen is the whole screen, not a fragment that survived.',
    );
    self::assertSame(
      1,
      substr_count($html, 'data-zone-heading'),
      'No description, no About zone — only Properties keeps its heading.',
    );
    self::assertStringNotContainsString(
      'class="rich-text',
      $html,
      'An empty body renders NOTHING, not an empty prose box.',
    );
  }

  /**
   * A reader who may see no run gets NO Run history zone (BB-414).
   *
   * MEASURED CAUSE, and it is a permission rather than a display defect: run
   * rows are rendered by `EntityReferenceEntityFormatter`, which filters its
   * referenced entities by `view` access, and `bb_run` declares
   * `administer bakers` as its `admin_permission`. So a reader without that
   * permission used to get the "Run history" heading over an empty zone —
   * visually identical to the unbound-`items` bug that shipped here once
   * already, and therefore exactly the sight nothing can distinguish from a
   * regression.
   *
   * WHAT THIS DOES AND DOES NOT BUY, stated so it is never read as "fixed".
   * Hiding the zone removes a misleading sight; it does not let the reader see
   * the runs, and it makes the permission cause LESS visible — a reader without
   * `administer bakers` now sees no trace of run history at all rather than an
   * empty box. That is an accepted trade by human decision; the permission
   * model is deliberately unchanged by this ticket and belongs to its own.
   */
  public function testTheRunHistoryZoneIsAbsentWhenNoRunIsVisible(): void {
    $this->giveTheTicketItsRuns();
    $privileged = $this->renderScreen();
    self::assertStringContainsString(
      'Run history',
      $privileged,
      'The control: a reader who MAY see the runs gets the zone.',
    );
    self::assertSame(3, substr_count($privileged, 'data-cell="state"'));

    // The same ticket, the same runs, a reader without `administer bakers`.
    $reader = $this->createUser(['view bb_ticket']);
    self::assertInstanceOf(UserInterface::class, $reader);
    $this->setCurrentUser($reader);
    $this->container->get('cache.render')->deleteAll();

    $html = $this->renderScreen();
    self::assertNotSame('', $html, 'The screen still renders for this reader.');
    self::assertStringNotContainsString(
      'data-cell="state"',
      $html,
      'No run is visible to this reader.',
    );
    self::assertStringNotContainsString(
      'Run history',
      $html,
      'And no heading is left standing over the zone they cannot see into.',
    );
  }

  /**
   * The rows carry their VALUES — state, from-state, conductor and start.
   *
   * Asserted on the rendered string, cell by cell. `data-cell` is the item's
   * own key, so each needle pins a value to the cell that is supposed to hold
   * it rather than to the page at large — `done` and `coding` are substrings of
   * half the theme's class names.
   */
  public function testTheRunRowsRenderTheirContent(): void {
    $this->giveTheTicketItsRuns();
    $html = $this->runHistoryZone($this->renderScreen());

    self::assertSame(
      ['running', 'srv01-bakers', 'done', 'srv01-bakers', 'expired', 'srv01-bakers'],
      $this->badgeLabelsIn($html),
      'Newest run first, each with its state badge and its conductor.',
    );
    self::assertSame(
      [
        'coding', '2026-02-03 03:40',
        'spec', '2026-02-02 03:40',
        'qualification', '2026-02-02 02:40', '18s',
      ],
      $this->monoValuesIn($html),
      'The from-state, the start to the MINUTE, and the duration where there is one.',
    );
    // The two faint words that make the row a sentence rather than a strip of
    // values. Both are the mapping's, and both are cells rather than prose.
    self::assertStringContainsString('>from</span>', $html);
    self::assertStringContainsString('>started</span>', $html);
    self::assertStringContainsString('>took</span>', $html);
  }

  /**
   * Cancel run sits on the active run's own row and names that run.
   */
  public function testCancelRunSitsOnTheActiveRunsRow(): void {
    $running = $this->createRun('running', 'coding', 1770090000);
    $done = $this->createRun('done', 'spec', 1770003600);

    $row = $this->runRow($running);
    $html = (string) $this->container->get('renderer')->renderInIsolation($row);
    self::assertMatchesRegularExpression(
      '#data-cell="cancel">.*?run=' . preg_quote($running->uuid(), '#') . '.*?>\s*Cancel run\s*<#s',
      $html,
      'The running run offers Cancel run for itself.',
    );
    $row = $this->runRow($done);
    $html = (string) $this->container->get('renderer')->renderInIsolation($row);
    self::assertStringNotContainsString('data-cell="cancel"', $html, 'A finished run offers none.');
  }

  /**
   * EVERY STATE CARRIES ITS OWN GLYPH — six states, six distinct sprites.
   *
   * This is C2 rather than decoration, and the entity mapping says why: tone is
   * COLOUR, so a state told only by its tone is a state a colour-blind reader
   * cannot read. The mapping this row's shape came from replaced one that
   * collided `running` and `done` on the same tone. Asserted as a SET so a
   * duplicate glyph fails even when all five render.
   */
  public function testEveryRunStateCarriesItsOwnGlyph(): void {
    $glyphs = [];
    foreach (['claimed', 'running', 'done', 'expired', 'failed', 'cancelled'] as $state) {
      $run = $this->createRun($state, 'coding', 1770000000);
      $row = $this->runRow($run);
      $html = (string) $this->container->get('renderer')->renderInIsolation($row);
      preg_match('#sprite\.svg(?:\?[^"\#]*)?\#([a-z-]+)#', $html, $match);
      $glyphs[$state] = $match[1] ?? '';
      $run->delete();
    }

    self::assertSame(
      [
        'claimed' => 'lock',
        'running' => 'run',
        'done' => 'check',
        'expired' => 'clock',
        'failed' => 'alert-triangle',
        'cancelled' => 'x-circle',
      ],
      $glyphs,
      'The glyph map is the entity mapping\'s, and no two states share one.',
    );

    // A glyph naming a symbol that does not exist renders NOTHING — the
    // `<use href="…sprite.svg#name">` resolves to no element and the badge is
    // told by tone alone, which is the exact colour-blind failure this test
    // exists to prevent (BB-536 review-4). Checking against the theme's own
    // icon sources is what a hardcoded expectation above cannot catch: it
    // would happily assert a name that has never existed.
    $icon_dir = \Drupal::service('extension.list.theme')->getPath('bb_theme') . '/assets/icons/src';
    foreach ($glyphs as $state => $glyph) {
      self::assertFileExists("$icon_dir/$glyph.svg", "State '$state' names a glyph with no icon source.");
    }
  }

  /**
   * The TRIPWIRE under the whole binding: `items` still guesses `unknown`.
   *
   * `BbRunRowSource` declares `prop_types: ['unknown']`, and that is the only
   * reason display_builder resolves it for this prop — ui_patterns'
   * compatibility checker does not descend into an array item's object
   * `properties`, so `list.items` comes out `unknown` and NO contrib source
   * declares that. If a future release starts guessing a real PropType,
   * `SourcePluginBase::getValue()` would hunt a conversion path from `unknown`,
   * find none, and the zone would go empty again WITHOUT AN ERROR — which is
   * exactly how the gap survived every gate the first time. Asserted here so
   * that release is a red test instead.
   */
  public function testTheItemsPropStillGuessesTheUnknownPropType(): void {
    // The component lives in the theme, so the theme has to be installed
    // before the component manager can see it at all.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $schema = $this->container->get('plugin.manager.sdc')
      ->find('bb_theme:list')->metadata->schema['properties'] ?? [];
    $guess = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->guessFromSchema($schema['items']);

    self::assertSame('unknown', $guess?->getPluginId());
    self::assertContains(
      'unknown',
      $this->container->get('plugin.manager.ui_patterns_source')
        ->getDefinition('bb_run_row')['prop_types'],
      'The source declares the PropType the prop actually guesses.',
    );
  }

  /**
   * Builds the full entity display the way the canonical route does.
   *
   * @return array<mixed>
   *   The resolved entity-view render array.
   */
  private function screen(): array {
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $builder = $this->container->get('entity_type.manager')->getViewBuilder('bb_ticket');
    $build = $builder->view($this->ticket, 'full');
    $this->container->get('renderer')->renderInIsolation($build);
    return $build;
  }

  /**
   * Renders the screen to markup.
   */
  private function renderScreen(): string {
    $this->tabsOn(self::ROUTE, ['bb_ticket' => $this->ticket]);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $builder = $this->container->get('entity_type.manager')->getViewBuilder('bb_ticket');
    $build = $builder->view($this->ticket, 'full');
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * The inspector's `list` items — the sixteen rows, as DATA.
   *
   * `list.items` is a PROP and not a slot (F10), which is exactly why the rail
   * cannot come from a view mode: props carry scalar data only, and no
   * display_builder source produces a nested array of keyed cells.
   *
   * @return array<int, array<string, mixed>>
   *   The item array.
   */
  private function inspectorItems(): array {
    return array_values($this->container->get('bb_core.ticket_inspector_rows')->build($this->ticket));
  }

  /**
   * The Properties block's visible rows, empty stall omitted.
   *
   * @return array<int, array<string, mixed>>
   *   The item array.
   */
  private function propertiesItems(): array {
    $rows = $this->container->get('bb_core.ticket_inspector_rows');
    return $rows->propertiesBlock($rows->build($this->ticket))['#slots']['content']['#props']['items'];
  }

  /**
   * One inspector row's cells, addressed by its visible label.
   *
   * @param string $label
   *   The row's label, e.g. `Env vars`.
   *
   * @return array<string, array<string, mixed>>
   *   The row's cells.
   */
  private function inspectorRow(string $label): array {
    foreach ($this->inspectorItems() as $item) {
      if ((string) $item['cells']['label']['value'] === $label) {
        return $item['cells'];
      }
    }
    self::fail(sprintf('The inspector has no "%s" row.', $label));
  }

  /**
   * Fills every meta field the rail reads, so the rows have values to show.
   *
   * Deliberately ONE fixture rather than one per row: the rail's claim is that
   * all fourteen fields have a place, and fourteen separate fixtures would let
   * a field be dropped between them without any test noticing.
   */
  private function enrichTheTicket(): void {
    $etm = $this->container->get('entity_type.manager');
    $project_id = $this->ticket->get('project_id')->target_id;

    foreach (['Christian Wiedemann', 'Sven Gruber', 'Marieke van Dijk'] as $name) {
      $account = $etm->getStorage('user')->create(['name' => $name]);
      $account->save();
      $accounts[$name] = $account;
    }

    $owner = $etm->getStorage('user')->create(['name' => 'conductor-owner']);
    $owner->save();
    $conductor = $etm->getStorage('bb_conductor')->create([
      'conductor_id' => 'cw-framework',
      'label' => 'cw-framework',
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $project_id,
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $conductor->save();

    $labels = [];
    foreach (['backend', 'ui'] as $name) {
      $term = $etm->getStorage('bb_term')->create([
        'vid' => 'bb_labels',
        'name' => $name,
        'workspace_id' => $this->workspace->id(),
      ]);
      $term->save();
      $labels[] = $term->id();
    }

    $environment = $etm->getStorage('bb_environment')->create([
      'name' => 'develop',
      'project_id' => $project_id,
    ]);
    $environment->save();

    $related = [];
    foreach (['child', 'blocker', 'referenced', 'parent'] as $role) {
      $other = $etm->getStorage('bb_ticket')->create([
        'workflow' => 'bb_feature',
        'title' => ucfirst($role),
        'state' => 'coding',
        'project_id' => $project_id,
      ]);
      $other->save();
      self::assertInstanceOf(BbTicketInterface::class, $other);
      $related[$role] = $other;
    }
    $related['child']->set('parent_id', $this->ticket->id())->save();

    $this->ticket
      ->set('assignee_user_id', $accounts['Marieke van Dijk']->id())
      ->set('conductor_id', $conductor->id())
      ->set('priority', 2)
      ->set('labels', $labels)
      ->set('time_estimate', 4 * 3600)
      ->set('time_spent', 3 * 3600)
      ->set('branch_name', 'feat/bb-142-detail')
      ->set('environments', [$environment->id()])
      ->set('env_vars', "BB_TARGET=super-secret-value\n")
      ->set('parent_id', $related['parent']->id())
      ->set('blocked_by', [$related['blocker']->id()])
      ->set('referenced_tickets', [$related['referenced']->id()]);
    $this->ticket->save();

    // Reloaded so the computed reverse references — `sub_tickets`,
    // `base_branch`, `effective_env_vars` — are recomputed against the saved
    // relations rather than answering from the pre-save item lists.
    $storage = $etm->getStorage('bb_ticket');
    $storage->resetCache([$this->ticket->id()]);
    $reloaded = $storage->load($this->ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->ticket = $reloaded;
  }

  /**
   * The state-flow component inside the band's flow slot.
   *
   * A stall badge may share the slot, in which case the chain sits at `state`.
   *
   * @param array<string, mixed> $band
   *   The summary-band render array.
   *
   * @return array<string, mixed>
   *   The `bb_theme:state-flow` render array.
   */
  private function stateFlowOf(array $band): array {
    $flow = $band['#slots']['flow'] ?? [];
    if (($flow['#component'] ?? NULL) === 'bb_theme:state-flow') {
      return $flow;
    }
    return $flow['state'] ?? [];
  }

  /**
   * The screen's one `summary-band`.
   *
   * @return array<mixed>
   *   The band's render array.
   */
  private function band(): array {
    $bands = $this->findComponents($this->screen(), 'bb_theme:summary-band');
    self::assertCount(1, $bands);
    return $bands[0];
  }

  /**
   * Gives the ticket one link of every kind, saved through the normaliser.
   *
   * Saved rather than set, because `BbTicket::preSave()` is what writes
   * `options.bakers.kind` — a fixture that set the options by hand would test the
   * mapper against data the application never produces.
   */
  private function giveTheTicketItsLinks(): void {
    $this->ticket->set('links', [
      ['uri' => 'https://gitlab.example.com/g/g/-/merge_requests/88', 'title' => 'MR !88'],
      ['uri' => 'https://gitlab.example.com/g/g/-/tree/feat/x', 'title' => 'Branch'],
      ['uri' => 'https://gitlab.example.com/g/g/-/pipelines/48213', 'title' => 'Pipeline'],
      ['uri' => 'https://gitlab.example.com/g/g/-/jobs/1/artifacts/file/r.html', 'title' => 'Report'],
      ['uri' => 'https://bb-142.ddev.site/admin/bakers/tickets', 'title' => 'Worktree'],
      ['uri' => 'https://example.com/designbook/index.html', 'title' => 'Designbook'],
      ['uri' => 'https://example.com/readme', 'title' => 'Docs'],
    ]);
    $this->ticket->save();
  }

  /**
   * Gives the ticket a summary comment and returns it.
   *
   * @return \Drupal\Core\Entity\EntityInterface
   *   The saved summary comment.
   */
  private function giveTheTicketItsSummary() {
    $storage = $this->container->get('entity_type.manager');
    $author = $storage->getStorage('user')->create(['name' => 'cw' . uniqid()]);
    $author->save();
    // `type` is the STORAGE field; `bb_comment_type` is only the JSON:API
    // attribute alias, and a payload keyed by the alias defaults to `comment`.
    $comment = $storage->getStorage('bb_comment')->create([
      'ticket_id' => $this->ticket->id(),
      'author' => $author->id(),
      'body' => ['value' => 'Coding done.', 'format' => 'bb_rich'],
      'type' => 'summary',
      'created' => 2000,
    ]);
    $comment->save();
    return $comment;
  }

  /**
   * Writes the six shipped ticket-detail config objects into active config.
   *
   * READ FROM THE SHIPPED FILES, RAW, and both halves are deliberate. Raw,
   * because `EntityDisplayBase::preSave()` materialises `content` and `hidden`
   * on the first save — creating these through the entity API would test the
   * re-saved form rather than the bytes that ship, which is precisely the
   * difference `designbook/sync/README.md` warns costs a `ddev init`. From the
   * install-path copies rather than `config/sync`, because those are the copies
   * the recipe installs and they are the ones without a `uuid`.
   *
   * THE SIX DO NOT ALL COME FROM ONE DIRECTORY, and that is the shipping split
   * rather than an accident of this fixture (BB-414, revising D4). The three
   * VIEW MODES stay in `bb_core/config/optional`: they carry no
   * `third_party_settings.display_builder`, so nothing about them is unsafe on
   * the plain module-install path that every Kernel and Functional test takes,
   * and being created at module-install time is exactly what guarantees a mode
   * exists before the display naming it is imported. The three DISPLAYS moved
   * to `recipes/bakers/config/`, because `RecipeRunner::installModule()` runs
   * `ConfigInstaller::installOptionalConfig()` — anything under
   * `config/optional` is created at MODULE-INSTALL time, before the recipe's
   * `config:` step creates the `bb_labels` vocabulary that ui_patterns'
   * sample `bb_ticket` needs, and the resulting `Missing entity bundle`
   * aborts the whole recipe. The same move is what stopped a display_builder
   * third-party-settings payload reaching `bb_login`'s functional tests,
   * which have no schema for it.
   *
   * `installConfig(['bb_core'])` cannot do any of this: it reads
   * `config/install` only.
   */
  private function installTicketDetailDisplays(): void {
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    // `filter.format.bb_rich` FIRST, and it is not optional decoration: the
    // About zone feeds `rich-text.body` from `description:processed`, and an
    // unknown format processes to the empty string — which is now the ABSENT
    // zone rather than a 500, but an About zone that silently disappears would
    // make every assertion below measure the wrong screen. It is written one by
    // one rather than through `installConfig(['bb_core'])`, because that also
    // installs `bb_core.settings` and ten `og.og_role.*` and dies on the
    // `bb_labels` vocabulary this test has no reason to create.
    $this->writeShippedConfig($target, $module . '/config/install', 'filter.format.bb_rich');
    foreach ([
      'core.entity_view_mode.bb_ticket.full' => $module . '/config/optional',
      'core.entity_form_mode.bb_ticket.property' => $recipe,
      'core.entity_form_display.bb_ticket.bb_ticket.property' => $recipe,
      'core.entity_view_display.bb_ticket.bb_ticket.full' => $recipe,
      'core.entity_view_mode.bb_run.teaser' => $module . '/config/optional',
      'core.entity_view_display.bb_run.bb_run.teaser' => $recipe,
      'core.entity_view_mode.bb_comment.full' => $module . '/config/optional',
      'core.entity_view_display.bb_comment.bb_comment.full' => $recipe,
      'core.entity_view_display.bb_comment.review.full' => $recipe,
      'core.entity_view_mode.bb_comment.teaser' => $module . '/config/optional',
      'core.entity_view_display.bb_comment.bb_comment.teaser' => $recipe,
      'core.entity_view_display.bb_comment.review.teaser' => $recipe,
    ] as $name => $directory) {
      $this->writeShippedConfig($target, $directory, $name);
    }
  }

  /**
   * Writes one SHIPPED config file into active config, byte for byte.
   *
   * @param \Drupal\Core\Config\StorageInterface $target
   *   Active config storage.
   * @param string $directory
   *   The directory the file ships in — the module's `config/optional` for the
   *   view modes, `recipes/bakers/config` for the three displays.
   * @param string $name
   *   The config name, without the `.yml`.
   */
  private function writeShippedConfig($target, string $directory, string $name): void {
    $file = $directory . '/' . $name . '.yml';
    self::assertFileExists($file, sprintf('%s ships on the recipe path.', $name));
    $data = Yaml::decode((string) file_get_contents($file));
    // A config entity needs a uuid to load, and the module-shipped copies
    // carry none — only the `config/sync` half does. Generating one here is
    // what `ConfigInstaller` does on the real install path.
    $data['uuid'] = $this->container->get('uuid')->generate();
    $target->write($name, $data);
  }

  /**
   * Three runs on the ticket — newest first, one of them timed.
   *
   * ONE FIXTURE FOR ALL THREE ROWS rather than one per assertion: the row's
   * claim is that a run's five values all reach the markup, and three separate
   * fixtures would let one drop out between them unnoticed. The third run
   * carries a `duration_s` and the other two do not, which is what makes the
   * conditional `took` pair measurable in the same render.
   */
  private function giveTheTicketItsRuns(): void {
    $this->createRun('expired', 'qualification', 1770000000, 18);
    $this->createRun('done', 'spec', 1770003600);
    $this->createRun('running', 'coding', 1770090000);

    // RELOADED, because `runs` is a COMPUTED reverse reference: the item list
    // on the in-memory ticket was materialised before any run existed and does
    // not re-query. Without this the screen renders an empty Run history zone
    // and every assertion below fails for a reason that has nothing to do with
    // the display.
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([$this->ticket->id()]);
    $reloaded = $storage->load($this->ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->ticket = $reloaded;
  }

  /**
   * One run on the ticket, claimed by the one conductor.
   *
   * @return \Drupal\Core\Entity\EntityInterface
   *   The saved run.
   */
  private function createRun(string $state, string $from, int $started, ?int $duration = NULL) {
    $etm = $this->container->get('entity_type.manager');
    $conductor = $etm->getStorage('bb_conductor')
      ->loadByProperties(['conductor_id' => 'srv01-bakers']);
    if ($conductor === []) {
      $owner = $etm->getStorage('user')->create(['name' => 'run-owner']);
      $owner->save();
      $entity = $etm->getStorage('bb_conductor')->create([
        'conductor_id' => 'srv01-bakers',
        'label' => 'srv01-bakers',
        'owner_user_id' => $owner->id(),
        'status' => 'online',
        'project_id' => $this->ticket->get('project_id')->target_id,
        'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
      ]);
      $entity->save();
    }
    else {
      $entity = reset($conductor);
    }

    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $this->ticket->id(),
      'conductor_id' => $entity->id(),
      'state' => $state,
      'state_at_start' => $from,
      'started_at' => $started,
      'duration_s' => $duration,
    ]);
    $run->save();
    return $run;
  }

  /**
   * One run rendered in the `teaser` mode — the row on its own.
   *
   * @param \Drupal\Core\Entity\EntityInterface $run
   *   The run to render.
   *
   * @return array<mixed>
   *   The render array.
   */
  private function runRow(EntityInterface $run): array {
    $this->container->get('theme_installer')->install(['bb_theme']);
    return $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_run')->view($run, 'teaser');
  }

  /**
   * The markup BETWEEN the Run history heading and the inspector rail.
   *
   * Sliced rather than searched whole, because the inspector rail is made of
   * the same `list` component with the same cell macro: an unsliced
   * `monoValuesIn()` picks up the rail's branch and base-branch rows and an
   * unsliced badge scan picks up its provenance badge. Slicing is also what
   * makes the value ORDER meaningful — inside the zone it is the mapping's
   * order, across the page it is the canvas's.
   */
  private function runHistoryZone(string $html): string {
    $start = strpos($html, 'Run history');
    self::assertIsInt($start, 'The Run history heading renders.');
    $end = strpos($html, 'bb_theme:inspector', $start);
    self::assertIsInt($end, 'The inspector rail closes the zone.');
    return substr($html, $start, $end - $start);
  }

  /**
   * The visible text of every `badge` in a render, in document order.
   *
   * @return array<int, string>
   *   The badge labels.
   */
  private function badgeLabelsIn(string $html): array {
    preg_match_all('#<span data-badge-label>([^<]*)</span>#', $html, $matches);
    return $matches[1];
  }

  /**
   * The visible text of every `mono` CELL in a render, in document order.
   *
   * The class list is the `cell()` macro's own, so this reads the cells the
   * mapping declared `mono` and nothing else.
   *
   * @return array<int, string>
   *   The monospaced values.
   */
  private function monoValuesIn(string $html): array {
    preg_match_all('#<span class="font-mono text-mono text-text-light">([^<]*)</span>#', $html, $matches);
    return $matches[1];
  }

  /**
   * The one canvas's slots.
   *
   * @return array<string, mixed>
   *   The canvas `#slots` array.
   */
  private function canvasSlots(): array {
    $canvases = $this->findComponents($this->screen(), 'bb_theme:canvas');
    self::assertCount(1, $canvases, 'There is exactly one canvas to read slots from.');
    return $canvases[0]['#slots'] ?? [];
  }

  /**
   * Every occurrence of one SDC component id in a render array.
   *
   * @param array<mixed> $build
   *   The render array to search.
   * @param string $component
   *   The component id, e.g. `bb_theme:canvas`.
   *
   * @return array<array<mixed>>
   *   The matching component render arrays, in document order.
   */
  private function findComponents(array $build, string $component): array {
    $found = [];
    $walk = static function (array $node) use (&$walk, &$found, $component): void {
      if (($node['#component'] ?? NULL) === $component) {
        $found[] = $node;
      }
      foreach ($node as $key => $child) {
        // Render metadata can retain a component's slot values under
        // `#context`; it is not another rendered component occurrence.
        if (is_string($key) && str_starts_with($key, '#') && $key !== '#slots') {
          continue;
        }
        if (is_array($child)) {
          $walk($child);
        }
      }
    };
    $walk($build);
    return $found;
  }

  /**
   * The local tasks the tab row would draw on one route, as route names.
   *
   * @param string $route_name
   *   The route the request is on.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $parameters
   *   The upcast route parameters beyond the workspace.
   *
   * @return array<string>
   *   The tab route names, in the order the bar draws them.
   */
  private function tabsOn(string $route_name, array $parameters): array {
    $provider = $this->container->get('router.route_provider');
    $route = $provider->getRouteByName($route_name);

    $search = ['{bb_workspace}'];
    $replace = [$this->workspace->getSlug()];
    $raw = ['bb_workspace' => $this->workspace->getSlug()];
    foreach ($parameters as $name => $entity) {
      $search[] = '{' . $name . '}';
      $replace[] = (string) $entity->id();
      $raw[$name] = (string) $entity->id();
    }

    $request = Request::create(str_replace($search, $replace, $route->getPath()));
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    foreach ($parameters as $name => $entity) {
      $request->attributes->set($name, $entity);
    }
    $request->attributes->set('_raw_variables', new ParameterBag($raw));
    $this->container->get('request_stack')->push($request);

    // A fresh manager per request: LocalTaskManager caches its built tasks
    // against the route match it was asked on, so a reused instance would
    // answer for the previous route.
    $manager = $this->container->get('plugin.manager.menu.local_task');
    $manager->clearCachedDefinitions();

    $names = [];
    foreach ($manager->getLocalTasks($route_name, 0)['tabs'] as $tab) {
      $names[] = $tab['#link']['url']->getRouteName();
    }
    return $names;
  }

}
