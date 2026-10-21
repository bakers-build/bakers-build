<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\Schema\Undefined;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\Core\TypedData\TraversableTypedDataInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * A `display_builder` sources tree on a view display validates against schema.
 *
 * THE DEFECT IS UPSTREAM AND IT IS TWO DEFECTS, measured on display_builder
 * 1.0.0-beta4. `display_builder_views.schema.yml` declares the following.
 *
 * @code
 *   sources:
 *     label: 'UI Patterns sources'
 *     sequence:
 *       type: ui_patterns_source.[source_id]
 * @endcode
 *
 * and both lines are wrong:
 *
 * 1. There is no `type: sequence` on `sources` itself, so the element falls
 *    back to `Undefined` and every save of a view carrying the extender reports
 *    `…display_extenders.display_builder.sources missing schema`.
 * 2. With that fixed by hand the next error is
 *    `…sources.0.source_id missing schema` and two siblings, because a sequence
 *    ITEM is the `{source_id, source, node_id}` triple a display-builder node
 *    is — not the *source configuration* that `ui_patterns_source.*` types
 *    describe. `ui_patterns_source.component` is a mapping with one key,
 *    `component`, so the triple has nothing to validate against.
 *
 * `display_builder_page_layout` stores the SAME data and gets it right:
 * `sources: {type: sequence, sequence: {type: ignore}}`. That is what this
 * repository aligns the views extender with.
 *
 * IT IS A PATCH NOW, NOT A HOOK OF OURS. Until 2026-09-05 a
 * `hook_config_schema_info_alter()` implementation of ours —
 * `DisplayBuilderViewsSchemaHooks` — reshaped the definition at runtime. A hook
 * repairing somebody else's schema file is a workaround for a defect that is
 * not ours, so the repository now carries
 * `patches/display_builder-views-sources-schema.patch` instead, applied by
 * `cweagans/composer-patches` with `composer-exit-on-patch-failure: true`. The
 * fix therefore reaches the SOURCE, and every install path that runs
 * `composer install` — the Docker image build, CI, `ddev init` — gets it.
 *
 * WHY IT MATTERS BEYOND TIDINESS. `ConfigSchemaChecker` is a test-only
 * listener, so on the live site the defect is silent — but
 * `$strictConfigSchema` is on by default in every Kernel and Functional test,
 * so with the defect in place NO test in this repository can install
 * `views.view.tickets` at all. Several of them do.
 *
 * THIS FILE IS THE REGRESSION GUARD ON THE PATCH, which is why it outlived the
 * hook it was written beside. It asserts the shape the schema must have,
 * whoever supplies it: if a future `composer install` ever loses the patch, or
 * a release renumbers the lines it edits, these three assertions are what says
 * so. Delete it only when a display_builder release carries the fix AND the
 * patch is gone from `composer.json`.
 */
#[Group('bb_core')]
final class DisplayBuilderViewsSchemaTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views',
    'display_builder', 'ui_patterns', 'ui_patterns_views',
    'display_builder_views', 'bb_core',
  ];

  /**
   * The `sources` element is a sequence, so it resolves at all.
   */
  public function testTheSourcesElementIsSequenceTyped(): void {
    $definition = $this->container->get('config.typed')
      ->getDefinition('views.display_extender.display_builder');

    self::assertSame(
      'sequence',
      $definition['mapping']['sources']['type'] ?? NULL,
      'Without a type the element is Undefined and every save reports "sources missing schema".',
    );
  }

  /**
   * A sequence item is the display-builder node, not a ui_patterns source.
   */
  public function testAnItemIsNotTypedAsSourceConfiguration(): void {
    $definition = $this->container->get('config.typed')
      ->getDefinition('views.display_extender.display_builder');
    $item = $definition['mapping']['sources']['sequence']['type'] ?? NULL;

    self::assertSame(
      'ignore',
      $item,
      'A node is {source_id, source, node_id}; ui_patterns_source.* describes only the `source` half.',
    );
  }

  /**
   * The real tree the ticket list ships validates, item by item.
   *
   * The two assertions above are about the definition. This one is about the
   * DATA, which is what actually broke: a definition can look plausible and
   * still leave a nested slot undefined.
   */
  public function testTheShippedTreeShapeValidates(): void {
    $typed = $this->container->get('config.typed');
    $element = $typed->createFromNameAndData(
      'views.display_extender.display_builder',
      [
        'profile' => 'default',
        'sources' => [
          [
            'source_id' => 'component',
            'source' => [
              'component' => [
                'component_id' => 'bb_theme:canvas',
                'variant_id' => NULL,
                'props' => [],
                'slots' => [
                  'main' => [
                    'sources' => [
                      ['source_id' => 'view_rows', 'source' => [], 'node_id' => 'n'],
                    ],
                  ],
                ],
              ],
            ],
            'node_id' => 'tickets_canvas',
          ],
        ],
      ],
    );

    self::assertInstanceOf(ComplexDataInterface::class, $element);
    $sources = $element->get('sources');
    self::assertInstanceOf(TraversableTypedDataInterface::class, $sources);
    self::assertNotInstanceOf(
      Undefined::class,
      $sources,
      'The sources element itself has no schema.',
    );
    $node = NULL;
    foreach ($sources as $item) {
      $node = $item;
      break;
    }
    self::assertNotNull($node, 'The sequence holds no items.');
    self::assertNotInstanceOf(
      Undefined::class,
      $node,
      'A node in the tree has no schema.',
    );
  }

}
