<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;

/**
 * The `bb_markdown` form element: a Markdown toolbar over a plain textarea.
 *
 * The element renders `bb_theme:form_rich_text`, so the theme is installed
 * and active. Its value handling is core's textarea: what the author typed is
 * what the form receives.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbMarkdownElementTest extends KernelTestBase {

  /**
   * The toolbar buttons, in order, with their accessible names.
   */
  private const BUTTONS = [
    'md-header' => 'Heading',
    'md-bold' => 'Bold',
    'md-italic' => 'Italic',
    'md-code' => 'Code',
    'md-link' => 'Link',
    'md-unordered-list' => 'Bullet list',
    'md-ordered-list' => 'Numbered list',
  ];

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
    $this->installConfig(['system', 'filter']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * Each element gets its own toolbar, pointed at its own textarea.
   */
  public function testRendersToolbarOverItsOwnTextarea(): void {
    $page = $this->renderForm([
      'body_a' => ['#type' => 'bb_markdown', '#title' => 'A'],
      'body_b' => ['#type' => 'bb_markdown', '#title' => 'B'],
    ]);

    foreach (['edit-body-a', 'edit-body-b'] as $id) {
      $toolbar = $page->filter("markdown-toolbar[for=\"$id\"]");
      self::assertCount(1, $toolbar, "No single toolbar targets #$id.");
      self::assertSame('toolbar', $toolbar->attr('role'));
      self::assertSame('Text formatting', $toolbar->attr('aria-label'));
      self::assertSame(
        self::BUTTONS,
        array_combine(
          $toolbar->children()->each(fn (Crawler $b): string => $b->nodeName()),
          $toolbar->children()->each(fn (Crawler $b): string => (string) $b->attr('aria-label')),
        ),
      );
      self::assertSame(['button'], array_unique($toolbar->children()->each(fn (Crawler $b): string => (string) $b->attr('role'))));
      // The toolbar sits directly above its textarea in the same wrapper.
      self::assertSame($id, $toolbar->nextAll()->filter('textarea')->attr('id'));
    }
    self::assertCount(1, $page->filter('textarea[name="body_a"]'));
  }

  /**
   * The submitted value is the textarea text, byte for byte.
   */
  public function testSubmittedValueIsTheTextareaText(): void {
    $typed = "## A\n\n<b>x</b> **y**\n\n";
    $form_state = new FormState();
    $form_state->setUserInput(['body' => $typed, 'form_id' => 'bb_markdown_element_test_form']);
    $form_state->setProgrammed();
    $form_state->setAlwaysProcess(TRUE);
    $this->container->get('form_builder')->buildForm(
      $this->formOf(['body' => ['#type' => 'bb_markdown', '#title' => 'Body']]),
      $form_state,
    );

    self::assertSame($typed, $form_state->getValue('body'));
  }

  /**
   * A disabled body is read-only text: no toolbar.
   */
  public function testDisabledRendersNoToolbar(): void {
    $page = $this->renderForm([
      'body' => ['#type' => 'bb_markdown', '#title' => 'Body', '#disabled' => TRUE, '#default_value' => 'Read me'],
    ]);

    self::assertCount(0, $page->filter('markdown-toolbar'));
    $textarea = $page->filter('textarea#edit-body');
    self::assertCount(1, $textarea);
    self::assertNotNull($textarea->attr('disabled'));
    self::assertSame('Read me', $textarea->text());
  }

  /**
   * Builds and renders a one-form page holding the given elements.
   *
   * @param array<string, mixed> $elements
   *   The form elements, keyed by name.
   */
  private function renderForm(array $elements): Crawler {
    $form = $this->container->get('form_builder')->getForm($this->formOf($elements));
    $html = (string) $this->container->get('renderer')->renderRoot($form);
    return new Crawler($html);
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
        return 'bb_markdown_element_test_form';
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
