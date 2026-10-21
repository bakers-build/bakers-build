<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Plugin\Component;
use Drupal\Core\Render\Markup;
use Drupal\Core\Theme\Component\ComponentValidator;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * The ninth cell kind of `bb_theme:table` carries already-rendered markup.
 *
 * WHY A NINTH KIND AND NOT A SLOT. The view is now bound by core's own table
 * style over nine real Views fields, and each field renders itself through its
 * formatter — so what reaches a cell is markup somebody else already produced.
 * `table.component.yml` prescribes exactly one answer to a value shape its
 * kinds cannot express: *"A value shape the eight kinds cannot express is the
 * signal to add a ninth kind deliberately, never to reintroduce a slot."* This
 * is that ninth kind.
 *
 * WHY THE VALUE MUST BE A `MarkupInterface` AND NOT A STRING, measured rather
 * than reasoned. Three facts decide the declaration and all three are asserted
 * below, because each of them would rot silently:
 *
 * - SDC's class-type escape hatch is TOP-LEVEL ONLY.
 *   `ComponentValidator::getClassProps()` loops `props.properties` exactly once
 *   and never recurses, so a field four levels down at
 *   `rows[].cells.<key>.markup` cannot be typed as `MarkupInterface`. The
 *   declaration therefore has to be `type: string`.
 * - A `MarkupInterface` SATISFIES `type: string` anyway.
 *   `MarkupInterface extends \JsonSerializable`, and the JSON-Schema validator
 *   sees props through `Validator::arrayToObjectRecursive()`, which is
 *   json-encode based — so the object arrives at the validator as its string.
 * - Twig prints a `MarkupInterface` UNESCAPED and exactly once, where it
 *   escapes a plain string. So the object is not a convenience: it is the only
 *   value that renders correctly, and `|raw` on a string would be blind
 *   unescaping of content this component never inspected.
 */
#[Group('bb_core')]
final class TableRenderedCellTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * `ui_patterns` is present because the site never renders an SDC component
   * without it: its node visitor injects prop normalization into EVERY
   * component template, so a test without it renders in a configuration that
   * does not exist in production.
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'views', 'ui_patterns',
  ];

  /**
   * The markup a formatter hands the cell, chosen to expose double-escaping.
   *
   * It carries BOTH a tag and an entity: a tag alone cannot tell single
   * escaping from none, and an entity alone cannot tell double escaping from
   * correct output.
   */
  private const string PROBE = '<span class="probe">A &amp; B</span>';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * The component declares the ninth kind and the field that carries it.
   *
   * Asserted through `ComponentValidator` DIRECTLY rather than by rendering,
   * because core's own validation is an `assert()` that is compiled out
   * wherever `zend.assertions` is not 1 — so a render proves nothing about the
   * declaration, and this is the only place the declaration is a gate.
   */
  public function testTheComponentDeclaresTheRenderedKind(): void {
    $props = [
      'columns' => [['key' => 'probe', 'label' => 'Probe']],
      'rows' => [
        [
          'cells' => [
            'probe' => ['kind' => 'rendered', 'markup' => Markup::create(self::PROBE)],
          ],
        ],
      ],
    ];

    self::assertTrue(
      $this->validator()->validateProps($props, $this->component()),
      'A `rendered` cell holding a MarkupInterface is of the declared shape.',
    );
  }

  /**
   * A render array in the same field is rejected, and that is the contract.
   *
   * A Views field handler returns a render ARRAY. If that array could be put
   * into the cell unrendered, every caller would be free to hand the component
   * something it cannot print — so the rejection is the thing that forces the
   * caller to render first, and it is asserted rather than assumed.
   */
  public function testRenderArrayIsRejectedSoTheCallerMustRenderFirst(): void {
    $props = [
      'columns' => [['key' => 'probe', 'label' => 'Probe']],
      'rows' => [
        [
          'cells' => [
            'probe' => ['kind' => 'rendered', 'markup' => ['#markup' => self::PROBE]],
          ],
        ],
      ],
    ];

    $this->expectExceptionMessageMatches('/Object value found, but a string is required/');
    $this->validator()->validateProps($props, $this->component());
  }

  /**
   * The markup reaches the cell intact — not escaped, and not escaped twice.
   */
  public function testMarkupPassesThroughTheCellUnescaped(): void {
    $html = $this->renderCell(Markup::create(self::PROBE));

    self::assertStringContainsString(
      self::PROBE,
      $html,
      'The formatter already produced this markup; the cell must print it.',
    );
    self::assertStringNotContainsString('&lt;span', $html);
    self::assertStringNotContainsString('&amp;amp;', $html);
  }

  /**
   * A plain string in the same field IS escaped, which is why the object wins.
   *
   * This is the test that makes the declaration meaningful. Without it nothing
   * would notice a caller "simplifying" the formatter to hand over a string —
   * the enum would still pass, the schema would still validate, and the screen
   * would quietly print tag soup at the reader.
   */
  public function testPlainStringIsEscapedAndSoIsNotAnAlternative(): void {
    $html = $this->renderCell(self::PROBE);

    self::assertStringContainsString('&lt;span', $html);
    self::assertStringNotContainsString(self::PROBE, $html);
  }

  /**
   * Renders a one-cell table whose only cell is the ninth kind.
   *
   * @param mixed $markup
   *   The value put into the cell's `markup` field.
   *
   * @return string
   *   The rendered table.
   */
  private function renderCell(mixed $markup): string {
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:table',
      '#props' => [
        'columns' => [['key' => 'probe', 'label' => 'Probe']],
        'rows' => [
          [
            'cells' => ['probe' => ['kind' => 'rendered', 'markup' => $markup]],
          ],
        ],
      ],
    ];

    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * The table component, as the plugin manager resolves it.
   *
   * @return \Drupal\Core\Plugin\Component
   *   The component.
   */
  private function component(): Component {
    $component = $this->container->get('plugin.manager.sdc')->find('bb_theme:table');
    self::assertInstanceOf(Component::class, $component);
    return $component;
  }

  /**
   * A validator with the JSON-Schema library attached.
   *
   * @return \Drupal\Core\Theme\Component\ComponentValidator
   *   The validator.
   */
  private function validator(): ComponentValidator {
    $validator = new ComponentValidator();
    $validator->setValidator();
    return $validator;
  }

}
