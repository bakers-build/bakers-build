<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\WidgetInterface;
use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Validator\ConstraintViolation;

/**
 * Verifies BbRepoWidget renders help text on each of its inputs.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbRepoWidgetTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'og',
    'link', 'text', 'filter', 'field', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * Instantiates the bb_repo widget for a fresh project's repository field.
   *
   * @return \Drupal\Core\Field\WidgetInterface
   *   The bb_repo widget plugin.
   */
  private function repoWidget(): WidgetInterface {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'p']);
    assert($project instanceof ContentEntityInterface);
    $items = $project->get('repository');
    assert($items instanceof FieldItemListInterface);
    $widget = $this->container->get('plugin.manager.field.widget')->getInstance([
      'field_definition' => $items->getFieldDefinition(),
      'form_mode' => 'default',
      'configuration' => [
        'type' => 'bb_repo',
        'settings' => [],
        'third_party_settings' => [],
      ],
    ]);
    assert($widget instanceof WidgetInterface);
    return $widget;
  }

  /**
   * Builds the repo widget's form element for a fresh project.
   *
   * @return array<string, mixed>
   *   The render array returned by BbRepoWidget::formElement().
   */
  private function repoElement(): array {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'p']);
    assert($project instanceof ContentEntityInterface);
    $items = $project->get('repository');
    assert($items instanceof FieldItemListInterface);
    $form = [];
    $form_state = new FormState();
    return $this->repoWidget()->formElement($items, 0, ['#required' => FALSE], $form, $form_state);
  }

  /**
   * The URL input documents the accepted formats.
   */
  public function testUrlDescriptionNamesAcceptedFormats(): void {
    $element = $this->repoElement();
    $this->assertArrayHasKey('#description', $element['url']);
    $description = (string) $element['url']['#description'];
    $this->assertStringContainsString('https://', $description);
    $this->assertStringContainsString('ssh://git@host/path.git', $description);
    $this->assertStringContainsString('git@host:path.git', $description);
    // The scp shorthand is accepted, not rejected — no "not supported" hint.
    $this->assertStringNotContainsString('not supported', $description);
  }

  /**
   * The three parts read as one labelled fieldset with unchanged child keys.
   */
  public function testPartsAreGroupedInOneFieldset(): void {
    $element = $this->repoElement();
    $this->assertSame('fieldset', $element['#type']);
    $this->assertSame(['url', 'default_branch', 'branch_convention'], array_values(array_filter(array_keys($element), static fn ($key): bool => is_string($key) && $key[0] !== '#')));
  }

  /**
   * The URL input is a plain textfield so the url validator can't pre-empt.
   *
   * Drupal's '#type' => 'url' element validates absolute URLs via
   * UrlHelper::isValid($v, TRUE), which rejects both SSH forms (scp shorthand
   * has no scheme; 'ssh' is not whitelisted). Using a textfield defers
   * validation to the field-type constraint, which accepts SSH URLs.
   */
  public function testUrlInputIsTextfield(): void {
    $element = $this->repoElement();
    $this->assertSame('textfield', $element['url']['#type']);
  }

  /**
   * A url-property violation is flagged on the url sub-element only.
   *
   * The BbRepoUrl constraint targets the `url` property. Without an
   * errorElement() override the whole per-delta element is flagged, so the
   * empty (valid) default_branch/branch_convention inputs get wrongly marked
   * and the message never binds to the offending field (BB-136 AC-2).
   */
  public function testErrorElementRoutesToUrlSubElement(): void {
    $element = $this->repoElement();
    $violation = new ConstraintViolation('bad', 'bad', [], NULL, '0.url', 'not a url');
    $result = $this->repoWidget()->errorElement($element, $violation, [], new FormState());
    $this->assertSame($element['url'], $result);
  }

  /**
   * The branch inputs document their empty-value defaults.
   */
  public function testBranchDescriptionsNameDefaults(): void {
    $element = $this->repoElement();
    $this->assertArrayHasKey('#description', $element['default_branch']);
    $this->assertStringContainsString('main', (string) $element['default_branch']['#description']);
    $this->assertArrayHasKey('#description', $element['branch_convention']);
    $this->assertStringContainsString(
      'feat/[bb_ticket:identifier]-[bb_ticket:title]',
      (string) $element['branch_convention']['#description'],
    );
  }

}
