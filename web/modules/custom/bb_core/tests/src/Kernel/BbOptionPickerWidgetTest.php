<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\better_exposed_filters\Plugin\BetterExposedFiltersWidgetInterface;
use Drupal\views\Plugin\views\filter\FilterPluginBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;

/**
 * The widget renders one exposed filter as the theme's picker.
 *
 * The last test is the one that matters most and the one a render assertion
 * cannot stand in for. Spec F10 says no facet is operable today, and D8 answers
 * it with a real control per row — but a control the browser submits and the
 * form never reads is exactly as inoperable as no control at all. So the widget
 * is driven through the real form builder with the query string a browser
 * without JavaScript produces, and the assertion is on what the VIEW is handed:
 * `ViewsExposedForm::submitForm()` sets `$view->exposed_data` from
 * `$form_state->getValues()`, and that is where a filter reads its input.
 */
#[Group('bb_core')]
final class BbOptionPickerWidgetTest extends KernelTestBase {

  /**
   * The option set every fixture in this test offers.
   *
   * @var array<int, string>
   */
  private const array OPTIONS = ['coding', 'review'];

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'better_exposed_filters', 'bb_core',
  ];

  /**
   * The widget is a first-class BEF plugin, not a theme-layer interception.
   */
  public function testTheWidgetIsDiscoverable(): void {
    $definitions = $this->container
      ->get('plugin.manager.better_exposed_filters_filter_widget')
      ->getDefinitions();

    self::assertArrayHasKey('bb_option_picker', $definitions);
  }

  /**
   * One exposed filter becomes a picker carrying a list of its options.
   */
  public function testItRendersOptionPickerCarryingAnOptionList(): void {
    $form = $this->alter($this->selectElement(TRUE, ['coding']), ['clear_label' => 'Any state']);

    self::assertSame('component', $form['state']['#type']);
    self::assertSame('bb_theme:option_picker', $form['state']['#component']);
    self::assertSame('facet', $form['state']['#props']['variant']);
    self::assertSame('State', $form['state']['#props']['label']);
    self::assertSame(['coding'], $form['state']['#props']['values']);
    self::assertSame(['coding'], $form['state']['#props']['value_labels']);
    self::assertArrayNotHasKey(
      'name',
      $form['state']['#props'],
      'A named picker emits hidden inputs the row controls would duplicate.',
    );

    $list = $form['state']['#slots']['options'];
    self::assertSame('bb_theme:option_list', $list['#component']);
    self::assertSame('state', $list['#props']['input_name']);
    self::assertSame('Any state', $list['#props']['clear_label']);
    self::assertSame(
      [
        ['value' => 'coding', 'label' => 'coding', 'selected' => TRUE],
        ['value' => 'review', 'label' => 'review', 'selected' => FALSE],
      ],
      $list['#props']['options'],
    );
  }

  /**
   * The control follows the FIELD, which is what `multiple` states.
   */
  public function testTheControlKindFollowsTheFieldAndNotTheStyling(): void {
    $many = $this->alter($this->selectElement(TRUE, ['coding']));
    self::assertTrue($many['state']['#props']['multiple']);
    self::assertSame('checkbox', $many['state']['#slots']['options']['#props']['input_type']);

    $one = $this->alter($this->selectElement(FALSE, 'coding'));
    self::assertFalse($one['state']['#props']['multiple']);
    self::assertSame('radio', $one['state']['#slots']['options']['#props']['input_type']);
  }

  /**
   * The sentinel for "nothing chosen" is not a value and must not read as one.
   */
  public function testTheEmptySentinelIsNotReportedAsChosen(): void {
    $form = $this->alter($this->selectElement(FALSE, 'All'));

    self::assertSame([], $form['state']['#props']['values']);
    self::assertSame([], $form['state']['#props']['value_labels']);
    foreach ($form['state']['#slots']['options']['#props']['options'] as $option) {
      self::assertFalse($option['selected']);
    }
  }

  /**
   * The picked value reaches the form's values with no JavaScript at all.
   *
   * The element the widget leaves behind is a RENDER element, so without
   * `#input` the form builder would never look for it in the request and
   * `$view->exposed_data` would come back without the facet — the control would
   * be operable in the browser and inert in the view. The user input below is
   * literally what a browser submits for `<input type="checkbox" name="state[]"
   * value="coding">` in a GET form.
   */
  public function testThePickedValueReachesTheFormWithoutJavascript(): void {
    $element = $this->alter($this->selectElement(TRUE, []))['state'];

    $form_state = new FormState();
    $form_state->setUserInput(['state' => ['coding']]);
    $form_state->setMethod('get');
    $form_state->setAlwaysProcess(TRUE);
    $this->container->get('form_builder')->buildForm($this->formOf($element), $form_state);

    self::assertSame(
      ['coding'],
      $form_state->getValues()['state'] ?? NULL,
      'The submitted facet value never reached the form, so the view cannot read it.',
    );
  }

  /**
   * Clearing one facet keeps every other parameter in its submitted shape.
   *
   * The Any row is a link to this address without that facet. Writing every
   * retained key as `key[]=value` turns the scalars the same form submits —
   * sort, search, closed — into arrays. Better Exposed Filters then explodes
   * the sort value and the clear request returns 500.
   *
   * What would make this fail: serialising a scalar as `key[]=value`, or a
   * list as `key=value`, or leaving `state` in the address.
   */
  public function testTheClearAddressKeepsOtherParametersInTheirSubmittedShape(): void {
    $request = Request::create(
      '/list?state[]=coding&sort_bef_combine=changed_DESC&title=foo&closed=all&label[]=7',
    );
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $this->container->get('request_stack')->push($request);

    $form = $this->alter($this->selectElement(TRUE, ['coding']));

    self::assertSame(
      '/list?sort_bef_combine=changed_DESC&title=foo&closed=all&label[]=7',
      $form['state']['#slots']['options']['#props']['clear_url'],
    );
  }

  /**
   * The state facet offers one quick choice: every non-terminal ticket state.
   *
   * Terminality comes from the workflows, so a state no transition leaves
   * (`done`, `cancelled`) is never among the values. A facet that does not
   * ask for the choice gets none: the runs and board views reuse the widget
   * for other state facets.
   */
  public function testStateFacetOffersOnlyOpenStates(): void {
    $open = array_values(array_unique(array_merge(...array_values(TypeWorkflows::nonTerminalTicketStates()))));
    $terminal = array_merge(...array_values(TypeWorkflows::terminalTicketStates()));
    self::assertNotEmpty($open);
    self::assertNotEmpty($terminal);

    $form = $this->alter($this->selectElement(TRUE, []), ['open_states' => TRUE]);

    self::assertSame(
      [['label' => 'Only open states', 'values' => $open]],
      $form['state']['#slots']['options']['#props']['quick_choices'],
    );
    self::assertSame([], array_intersect($open, $terminal), 'A terminal state is offered as open.');

    $plain = $this->alter($this->selectElement(TRUE, []));
    self::assertArrayNotHasKey('quick_choices', $plain['state']['#slots']['options']['#props']);

    // Under the Closed position only terminal states are offered; a choice
    // that matches no row would act as Clear, so it is not offered either.
    $closed = $this->alter($this->selectElement(TRUE, [], $terminal), ['open_states' => TRUE]);
    self::assertArrayNotHasKey('quick_choices', $closed['state']['#slots']['options']['#props']);
  }

  /**
   * Runs the widget over an exposed form holding one `state` element.
   *
   * @param array<string, mixed> $element
   *   The exposed form element the widget replaces.
   * @param array<string, mixed> $configuration
   *   Per-filter widget configuration.
   *
   * @return array<string, mixed>
   *   The altered form.
   */
  private function alter(array $element, array $configuration = []): array {
    $form = ['state' => $element];
    $this->widget($configuration)->exposedFormAlter($form, new FormState());
    return $form;
  }

  /**
   * The widget, bound to a views filter handler exposed as `state`.
   *
   * @param array<string, mixed> $configuration
   *   Per-filter widget configuration.
   */
  private function widget(array $configuration = []): BetterExposedFiltersWidgetInterface {
    $widget = $this->container
      ->get('plugin.manager.better_exposed_filters_filter_widget')
      ->createInstance('bb_option_picker', $configuration);
    self::assertInstanceOf(BetterExposedFiltersWidgetInterface::class, $widget);

    $handler = $this->container
      ->get('plugin.manager.views.filter')
      ->createInstance('in_operator', []);
    self::assertInstanceOf(FilterPluginBase::class, $handler);
    $handler->options['expose']['identifier'] = 'state';
    $widget->setViewsHandler($handler);

    return $widget;
  }

  /**
   * The element Views builds for an exposed list filter.
   *
   * @param bool $multiple
   *   Whether the field holds several values at once.
   * @param array<int, string>|string $value
   *   The current exposed input.
   * @param array<int, string> $options
   *   The values the filter offers.
   *
   * @return array<string, mixed>
   *   The form element.
   */
  private function selectElement(bool $multiple, array|string $value, array $options = self::OPTIONS): array {
    return [
      '#type' => 'select',
      '#multiple' => $multiple,
      '#title' => 'State',
      '#options' => array_combine($options, $options),
      '#value' => $value,
    ];
  }

  /**
   * A one-element GET form, so the element can be driven by the form builder.
   *
   * @param array<string, mixed> $element
   *   The element to place at `state`.
   */
  private function formOf(array $element): FormInterface {
    return new class($element) implements FormInterface {

      /**
       * @param array<string, mixed> $element
       *   The element to place at `state`.
       */
      public function __construct(private readonly array $element) {}

      /**
       * {@inheritdoc}
       */
      public function getFormId(): string {
        return 'bb_option_picker_widget_test_form';
      }

      /**
       * {@inheritdoc}
       */
      public function buildForm(array $form, FormStateInterface $form_state): array {
        $form['state'] = $this->element;
        return $form;
      }

      /**
       * {@inheritdoc}
       */
      public function validateForm(array &$form, FormStateInterface $form_state): void {}

      /**
       * {@inheritdoc}
       */
      public function submitForm(array &$form, FormStateInterface $form_state): void {}

    };
  }

}
