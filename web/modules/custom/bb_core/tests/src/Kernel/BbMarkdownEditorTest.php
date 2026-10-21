<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\editor\Entity\Editor;
use Drupal\bb_core\Plugin\Editor\BbMarkdown;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\SchemaCheckTestTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;

/**
 * The `bb_markdown` text editor bound to the `bb_rich` format.
 *
 * Every `text_format` element on `bb_rich` gets the Markdown toolbar through
 * core's Editor API, and the toolbar the editor hands its JavaScript adapter is
 * the one the `bb_markdown` form element renders, so the two entry points
 * cannot drift.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbMarkdownEditorTest extends KernelTestBase {

  use SchemaCheckTestTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'editor', 'markdown_easy', 'og',
    'island', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system', 'filter', 'bb_core']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * The bb_rich format is bound to the toolbar editor by valid config.
   */
  public function testBbRichIsBoundToTheToolbar(): void {
    $editor = Editor::load('bb_rich');
    self::assertNotNull($editor, 'No editor is bound to bb_rich.');
    self::assertSame('bb_markdown', $editor->getEditor());
    $this->assertConfigSchemaByName('editor.editor.bb_rich');
  }

  /**
   * The editor's toolbar is exactly the element's toolbar.
   */
  public function testEditorToolbarIsTheElementsToolbar(): void {
    $editor = Editor::load('bb_rich');
    $plugin = $this->container->get('plugin.manager.editor')->createInstance('bb_markdown');
    self::assertInstanceOf(BbMarkdown::class, $plugin);
    $settings = $plugin->getJSSettings($editor);

    $element = $this->container->get('form_builder')->getForm($this->formOf([
      'bb_markdown_placeholder' => ['#type' => 'bb_markdown', '#id' => 'bakers-markdown-placeholder'],
    ]));
    $html = (string) $this->container->get('renderer')->renderRoot($element);

    self::assertSame(
      $this->toolbarOf($html),
      $this->toolbarOf($settings['toolbar']),
    );
    self::assertCount(1, (new Crawler($settings['toolbar']))->filter('textarea#bakers-markdown-placeholder'));
  }

  /**
   * A text_format element on bb_rich carries the editor.
   */
  public function testTextFormatOnBbRichCarriesTheEditor(): void {
    $this->installEntitySchema('user');
    $this->setUpCurrentUser([], ['use text format bb_rich']);
    $form = $this->container->get('form_builder')->getForm($this->formOf([
      'body' => ['#type' => 'text_format', '#format' => 'bb_rich', '#allowed_formats' => ['bb_rich']],
    ]));
    $html = (string) $this->container->get('renderer')->renderRoot($form);

    self::assertSame('edit-body-value', (new Crawler($html))->filter('[data-editor-for]')->attr('data-editor-for'));
    self::assertSame(
      'bb_markdown',
      $form['#attached']['drupalSettings']['editor']['formats']['bb_rich']['editor'] ?? NULL,
    );
  }

  /**
   * The bb_rich editor settings are on every page its user may write in.
   *
   * A form swapped in by htmx brings no drupalSettings, and core's editor
   * behavior attaches nothing without them, so they are attached up front.
   */
  public function testEveryPageCarriesTheEditorSettingsForWriters(): void {
    $this->installEntitySchema('user');

    $this->setUpCurrentUser([], ['use text format bb_rich']);
    $attachments = $this->pageAttachments();
    self::assertSame(
      'bb_markdown',
      $attachments['#attached']['drupalSettings']['editor']['formats']['bb_rich']['editor'] ?? NULL,
    );
    self::assertContains('user.permissions', $attachments['#cache']['contexts'] ?? []);
    self::assertContains('editor/drupal.editor', $attachments['#attached']['library'] ?? []);

    $this->setUpCurrentUser([], []);
    $attachments = $this->pageAttachments();
    self::assertArrayNotHasKey('editor', $attachments['#attached']['drupalSettings'] ?? []);
    self::assertNotContains('editor/drupal.editor', $attachments['#attached']['library'] ?? []);
  }

  /**
   * The attachments the active theme adds to a page.
   *
   * @return array<string, mixed>
   *   The page attachments.
   */
  private function pageAttachments(): array {
    $attachments = [];
    $this->container->get('theme.manager')->alter('page_attachments', $attachments);
    return $attachments;
  }

  /**
   * The toolbar subtree as a normalised tag/attribute/child sequence.
   *
   * @return list<string>
   *   One line per element, in document order.
   */
  private function toolbarOf(string $html): array {
    $toolbar = (new Crawler($html))->filter('markdown-toolbar');
    self::assertCount(1, $toolbar);
    $lines = [];
    $walk = function (\DOMElement $node) use (&$walk, &$lines): void {
      $attributes = [];
      foreach ($node->attributes as $attribute) {
        $attributes[] = $attribute->name . '=' . preg_replace('/\s+/', ' ', trim($attribute->value));
      }
      sort($attributes);
      $lines[] = $node->nodeName . '[' . implode(' ', $attributes) . ']';
      foreach ($node->childNodes as $child) {
        if ($child instanceof \DOMElement) {
          $walk($child);
        }
      }
    };
    $root = $toolbar->getNode(0);
    self::assertInstanceOf(\DOMElement::class, $root);
    $walk($root);
    return $lines;
  }

  /**
   * A form holding the given elements.
   *
   * @param array<string, mixed> $elements
   *   The form elements, keyed by name.
   */
  private function formOf(array $elements): FormInterface {
    return new class($elements) implements FormInterface {

      /**
       * @param array<string, mixed> $elements
       *   The form elements, keyed by name.
       */
      public function __construct(private readonly array $elements) {}

      /**
       * {@inheritdoc}
       */
      public function getFormId(): string {
        return 'bb_markdown_editor_test_form';
      }

      /**
       * {@inheritdoc}
       */
      public function buildForm(array $form, FormStateInterface $form_state): array {
        return $form + $this->elements;
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
