<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Form\SubmissionActionForm;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Discard and Submit act only on the employee's own submissions.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class SubmissionActionFormTest extends WorkTimeTestBase {

  /**
   * A proposal offers Discard, a draft offers Submit, and both act.
   */
  public function testSubmitOnlyForDraftAndDiscardOnlyForProposal(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $draft = Submission::create();
    $draft->save();
    $form = $this->container->get('form_builder')->getForm(SubmissionActionForm::class, [$proposal, $draft]);
    self::assertArrayHasKey('discard_' . $proposal->id(), $form['actions']);
    self::assertArrayNotHasKey('submit_' . $proposal->id(), $form['actions']);
    self::assertArrayHasKey('submit_' . $draft->id(), $form['actions']);
    self::assertArrayNotHasKey('discard_' . $draft->id(), $form['actions']);
    $this->press([$proposal, $draft], 'discard_' . $proposal->id());
    self::assertSame('discarded', Submission::load($proposal->id())->get('state')->value);
    $this->press([$draft], 'submit_' . $draft->id());
    self::assertSame('submitted', Submission::load($draft->id())->get('state')->value);
  }

  /**
   * A peer handed someone else's proposal gets no action and changes nothing.
   */
  public function testPeerCannotDiscardForeignProposal(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $this->container->get('current_user')->setAccount($this->peer);
    $form = $this->container->get('form_builder')->getForm(SubmissionActionForm::class, [$proposal]);
    self::assertArrayNotHasKey('discard_' . $proposal->id(), $form['actions'] ?? []);
    $this->press([$proposal], 'discard_' . $proposal->id());
    self::assertSame('proposed', Submission::load($proposal->id())->get('state')->value);
  }

  /**
   * A proposal saved in the meantime is not reported as discarded.
   */
  public function testStaleDiscardIsNotReportedAsSuccess(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $stored = Submission::load($proposal->id());
    $stored->serviceTransition = TRUE;
    $stored->set('state', 'draft')->save();
    $this->press([$proposal], 'discard_' . $proposal->id());
    $messages = $this->container->get('messenger')->all();
    self::assertArrayNotHasKey('status', $messages);
    self::assertNotEmpty($messages['error'] ?? []);
    self::assertSame('draft', Submission::load($proposal->id())->get('state')->value);
  }

  /**
   * The action form turns browser autocomplete off.
   */
  public function testActionFormTurnsAutocompleteOff(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $form = $this->container->get('form_builder')->getForm(SubmissionActionForm::class, [$proposal]);
    self::assertSame('off', $form['#attributes']['autocomplete'] ?? NULL);
  }

  /**
   * Submits the action form with one button.
   *
   * @param list<\Drupal\bb_track\Entity\Submission> $submissions
   *   Build argument.
   * @param string $button
   *   The triggering button name.
   */
  private function press(array $submissions, string $button): FormStateInterface {
    $state = new FormState();
    $state->setValues(['_triggering_element_name' => $button]);
    $this->container->get('form_builder')->submitForm(SubmissionActionForm::class, $state, $submissions);
    return $state;
  }

}
