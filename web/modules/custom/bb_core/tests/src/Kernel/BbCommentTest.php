<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\bb_core\Entity\BbComment;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies BbComment field defaults and type field acceptance.
 *
 * Checks that a newly created comment defaults to type 'comment', that the
 * conventional handler-output types (spec, plan, debug_diagnose, summary,
 * acceptance, scenario, test) round-trip, and that the field accepts values
 * outside that vocabulary — `type` is free text, so the conventional values are
 * conventions rather than an enforced enum (BB-227).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbCommentTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'field', 'og',
    'bb_core', 'state_machine', 'entity', 'user', 'options', 'text', 'link',
    'filter',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_comment');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('user');
  }

  /**
   * Verifies that the type field defaults to 'comment' when not specified.
   *
   * A freshly created comment with only a body value must persist with
   * type == 'comment' after save and reload.
   */
  public function testCommentTypeDefaultsToComment(): void {
    $comment = BbComment::create([
      'body' => ['value' => 'x', 'format' => 'bb_rich'],
    ]);
    $comment->save();
    $id = $comment->id();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $storage->resetCache([$id]);
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbCommentInterface::class, $reloaded);
    $this->assertSame('comment', $reloaded->get('type')->value);
  }

  /**
   * Verifies that handler-output type values are persisted correctly.
   *
   * A comment created with type 'spec' must round-trip through save/load
   * without being coerced to the default value.
   */
  public function testCommentAcceptsHandlerOutputType(): void {
    $comment = BbComment::create([
      'type' => 'spec',
      'body' => ['value' => 'spec body', 'format' => 'bb_rich'],
    ]);
    $comment->save();
    $id = $comment->id();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $storage->resetCache([$id]);
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbCommentInterface::class, $reloaded);
    $this->assertSame('spec', $reloaded->get('type')->value);
  }

  /**
   * Verifies that the 'test' type (BDD acceptance criteria) round-trips.
   *
   * A comment created with type 'test' must persist as 'test' and not be
   * coerced to the default 'comment' value.
   */
  public function testCommentAcceptsTestType(): void {
    $comment = BbComment::create([
      'type' => 'test',
      'body' => ['value' => 'Feature: x', 'format' => 'bb_rich'],
    ]);
    $comment->save();
    $id = $comment->id();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $storage->resetCache([$id]);
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbCommentInterface::class, $reloaded);
    $this->assertSame('test', $reloaded->get('type')->value);
  }

  /**
   * Verifies the 'acceptance' type (business acceptance criteria) round-trips.
   *
   * The `acceptance` comment is authored at ticket start (qualification or
   * create) and states the acceptance criteria in business prose — the `spec`
   * Gherkin `test` comment is derived from. It must persist as 'acceptance'
   * and not be coerced to the default 'comment' value.
   */
  public function testCommentAcceptsAcceptanceType(): void {
    $comment = BbComment::create([
      'type' => 'acceptance',
      'body' => ['value' => 'As a user I can ...', 'format' => 'bb_rich'],
    ]);
    $comment->save();
    $id = $comment->id();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $storage->resetCache([$id]);
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbCommentInterface::class, $reloaded);
    $this->assertSame('acceptance', $reloaded->get('type')->value);
  }

  /**
   * Verifies the 'scenario' type (Gherkin + Testanleitung) round-trips.
   *
   * The `scenario` comment is authored from the `acceptance` criteria and holds
   * the abstract Gherkin, the click-path Testanleitung (absolute worktree
   * URLs), and the AC↔scenario coverage matrix — distinct from the `test`
   * comment. It must persist as 'scenario' and not be coerced to 'comment'.
   */
  public function testCommentAcceptsScenarioType(): void {
    $comment = BbComment::create([
      'type' => 'scenario',
      'body' => ['value' => 'Given ... When ... Then ...', 'format' => 'bb_rich'],
    ]);
    $comment->save();
    $id = $comment->id();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $storage->resetCache([$id]);
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbCommentInterface::class, $reloaded);
    $this->assertSame('scenario', $reloaded->get('type')->value);
  }

  /**
   * The `type` field is declared as free text, not an enumeration.
   *
   * This is the storage-level half of BB-227: the conventional vocabulary is
   * documentation, so no `allowed_values` setting may reappear. A list field
   * would reject the next handler-output kind someone invents with a 422 and
   * lose the handoff a later step is waiting for.
   */
  public function testCommentTypeIsFreeStringField(): void {
    $definition = \Drupal::service('entity_field.manager')
      ->getBaseFieldDefinitions('bb_comment')['type'];

    $this->assertSame('string', $definition->getType());
    $this->assertTrue($definition->isRequired());
    $this->assertSame('comment', $definition->getDefaultValueLiteral()[0]['value']);
    $this->assertNull($definition->getSetting('allowed_values'),
      'type must declare no allowed_values — it is free text, not an enum.');
  }

  /**
   * A type outside the conventional vocabulary round-trips verbatim.
   *
   * `retro` is deliberately not one of the nine conventional values. Before
   * BB-227 this save failed the AllowedValues constraint; the value must now
   * survive save and reload **unchanged** — a free-text field that normalises
   * its input would silently rewrite what an agent wrote and break the readers
   * that select on an exact value.
   */
  public function testCommentAcceptsArbitraryType(): void {
    $comment = BbComment::create([
      'type' => 'retro',
      'body' => ['value' => 'Retro note: the enum is gone.', 'format' => 'bb_rich'],
    ]);
    $violations = $comment->validate();
    $this->assertCount(0, $violations->getByField('type'),
      'An arbitrary type must raise no validation violation.');

    $comment->save();
    $id = $comment->id();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $storage->resetCache([$id]);
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbCommentInterface::class, $reloaded);
    $this->assertSame('retro', $reloaded->get('type')->value);
  }

  /**
   * The event SDC must not constrain its `tag` to a fixed list.
   *
   * This guard is the inverse of the mirror it replaces. It used to assert that
   * the component's enum covered every allowed value of the entity field; with
   * the field open, an enum on the prop can only ever be behind the values it
   * describes, and the failure it produces is the worst kind — measured on a
   * running site, the display_builder render path does **not** raise the
   * ComponentValidator's rejection, it silently drops the prop, so a handoff of
   * a new kind is displayed as an ordinary untagged entry with nothing
   * signalling it. So the constraint must stay absent, and re-adding one has to
   * fail here rather than quietly on a page.
   *
   * The prop is `tag` and the component is `event` because a display has no
   * business knowing whose type field it is showing (BB-389 › D11): the same
   * shape serves a run handoff and a deployment note, and the mapping is what
   * decides which field becomes the tag.
   */
  public function testEventTagPropIsUnconstrained(): void {
    $yaml_path = DRUPAL_ROOT . '/themes/custom/bb_theme/components/event/event.component.yml';
    $this->assertFileExists($yaml_path);
    $component = Yaml::decode((string) file_get_contents($yaml_path));
    $prop = $component['props']['properties']['tag'] ?? [];

    $this->assertNotSame([], $prop, 'The tag prop must still be declared.');
    $this->assertSame('string', $prop['type'] ?? NULL);
    $this->assertArrayNotHasKey('enum', $prop,
      'tag must not enumerate permitted values — bb_comment.type is free text.');
  }

  /**
   * The event component renders an unknown tag AS that tag.
   *
   * The assertion that matters is the rendered **value**, never the absence of
   * an error: measured on a running site before the enum was removed, rendering
   * a `retro` comment produced the bundle's default type in the markup and
   * raised nothing at all. A test phrased as "renders without error" is
   * therefore green before and after, and proves nothing.
   *
   * Rendering the component directly (as a Storybook story or any non
   * display_builder template does) is also where the enum bites hardest: with
   * assertions enabled — `zend.assertions=1` in DDEV and CI — the prop
   * validator throws outright on an out-of-enum value.
   *
   * Both halves are asserted, because the attribute and the visible tag are two
   * places the value has to arrive: a template that carried the tag on the
   * element but rendered no tag text would satisfy an attribute-only check
   * while showing the reader nothing.
   */
  public function testEventRendersUnknownTagVerbatim(): void {
    \Drupal::service('theme_installer')->install(['bb_theme']);

    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:event',
      '#props' => [
        'author_name' => 'cw',
        'author_initials' => 'CW',
        'tag' => 'retro',
        'body' => 'Retro note: the enum is gone.',
      ],
    ];
    $html = (string) \Drupal::service('renderer')->renderInIsolation($build);

    $this->assertStringContainsString('data-tag="retro"', $html);
    $this->assertStringContainsString('>retro<', $html,
      'The tag must be VISIBLE, not only carried as an attribute.');
    $this->assertStringNotContainsString('data-tag=""', $html,
      'An unknown tag must not be silently dropped to the untagged rendering.');
  }

  /**
   * A comment created without an explicit author defaults to the current user.
   */
  public function testAuthorDefaultsToCurrentUser(): void {
    $user = \Drupal::entityTypeManager()->getStorage('user')->create(['name' => 'acting']);
    $user->save();
    \Drupal::currentUser()->setAccount($user);

    $comment = BbComment::create([
      'body' => ['value' => 'x', 'format' => 'bb_rich'],
    ]);
    $comment->save();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $storage->resetCache([$comment->id()]);
    $reloaded = $storage->load($comment->id());
    $this->assertInstanceOf(BbCommentInterface::class, $reloaded);
    $this->assertSame((int) $user->id(), (int) $reloaded->get('author')->target_id);
  }

}
