<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\island_example\Entity\Note;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests a ContentEntityForm wired as an island via IslandFormTrait.
 *
 * Fragment response after save, validation re-render, island HTMX wiring.
 */
#[Group('island')]
final class IslandEntityFormTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'user', 'field', 'island', 'island_example'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('island_example_note');
    Note::create(['title' => 'Release note', 'body' => 'Ship it'])->save();
  }

  /**
   * The island build arguments IslandPluginBase::getForm() supplies.
   */
  private function formArgs(): array {
    return ['island_id' => 'note', 'host_id' => 'tasks'];
  }

  /**
   * The entity edit form object for the seeded note.
   */
  private function formObject(): EntityFormInterface {
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('island_example_note', 'edit');
    $form_object->setEntity(Note::load(1));
    return $form_object;
  }

  /**
   * Builds the note edit form as the note island embeds it.
   */
  private function buildForm(FormState $form_state): array {
    $form_state->addBuildInfo('args', [$this->formArgs()]);
    return $this->container->get('form_builder')
      ->buildForm($this->formObject(), $form_state);
  }

  /**
   * The entity form carries the island HTMX wiring.
   */
  public function testEntityFormCarriesIslandHtmxWiring(): void {
    $form = $this->buildForm(new FormState());
    // Core's Htmx helper writes data-hx-* attribute keys on render arrays.
    $this->assertSame('#island-tasks-note', $form['#attributes']['data-hx-target']);
    $this->assertArrayHasKey('data-hx-drupal-only-main-content', $form['#attributes']);
    $this->assertContains('island/base', $form['#attached']['library'] ?? []);
  }

  /**
   * Submits the note edit form as the island's Save button would.
   */
  private function submitForm(array $values): FormStateInterface {
    $form_state = (new FormState())->setValues($values);
    // Mirror the browser flow: the Save button is the triggering element, so
    // its button-level submit handlers run (a programmed submission does not
    // default to the first button).
    $form_state->setSubmitHandlers(['::submitForm', '::save']);
    $form_state->addBuildInfo('args', [$this->formArgs()]);
    $this->container->get('form_builder')
      ->submitForm($this->formObject(), $form_state);
    return $form_state;
  }

  /**
   * A valid submit saves the entity and sets the fragment response.
   */
  public function testValidSubmitSavesEntityAndSetsFragmentResponse(): void {
    // Field widget values are nested by #parents: [field, delta, column].
    $form_state = $this->submitForm([
      'title' => [['value' => 'Updated note']],
      'body' => [['value' => 'Ship it']],
    ]);
    $this->assertEmpty($form_state->getErrors());
    $this->assertSame('Updated note', Note::load(1)->get('title')->value);
    $response = $form_state->getResponse();
    $this->assertNotNull($response);
    $html = (string) $response->getContent();
    $this->assertStringContainsString('id="island-tasks-note"', $html);
    $this->assertStringContainsString('Updated note', $html);
  }

  /**
   * An invalid submit re-renders with errors and never touches the entity.
   */
  public function testInvalidSubmitReRendersWithErrors(): void {
    $form_state = $this->submitForm([
      'title' => [['value' => '']],
      'body' => [['value' => 'x']],
    ]);
    $this->assertNotEmpty($form_state->getErrors());
    // Validation failure: no IslandResponse, Form API re-renders the form.
    $this->assertNull($form_state->getResponse());
    $this->assertSame('Release note', Note::load(1)->get('title')->value);
  }

}
