<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Form\FormState;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Review draft and decision forms expose only allowed transitions.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ReviewCommentFormTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use ReviewStateTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'island',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->createUser();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * A draft form offers Save draft and Submit review, not Accept or Reject.
   */
  public function testDraftFormOffersSubmitNotDecision(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $form = $this->form($review);
    self::assertSame('Save draft', (string) ($form['actions']['submit']['#value'] ?? ''));
    self::assertSame('Submit review', (string) ($form['actions']['submit_review']['#value'] ?? ''));
    self::assertArrayNotHasKey('accept', $form['actions']);
    self::assertArrayNotHasKey('reject', $form['actions']);
    self::assertFalse($form['body']['#disabled'] ?? FALSE);
  }

  /**
   * Ticket-edit rights do not show Accept on someone else's draft.
   */
  public function testOwnerDoesNotSeeAcceptOnDraft(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->setCurrentUser($actors['owner']);
    $form = $this->form($review);
    self::assertArrayNotHasKey('accept', $form['actions']);
    self::assertArrayNotHasKey('reject', $form['actions']);
    self::assertArrayNotHasKey('submit_review', $form['actions']);
  }

  /**
   * Submitting a draft makes it pending; the assignee then sees Accept/Reject.
   */
  public function testSubmitThenAssigneeDecides(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_comment', 'review');
    $form_object->setEntity($review);
    $form_state = new FormState();
    $form_state->setTriggeringElement(['#submit_review' => TRUE]);
    $form_object->save([], $form_state);
    $review = $this->reload($review);
    self::assertSame('submitted', (string) $review->get('review_state')->value);
    self::assertFalse($review->isPublished());

    $this->setCurrentUser($actors['assignee']);
    $form = $this->form($review);
    self::assertSame('Accept', (string) ($form['actions']['accept']['#value'] ?? ''));
    self::assertSame('Reject', (string) ($form['actions']['reject']['#value'] ?? ''));
    self::assertArrayNotHasKey('submit', $form['actions']);
    self::assertTrue($form['body']['#disabled'] ?? FALSE);

    $this->setCurrentUser($actors['reviewer']);
    $author_form = $this->form($review);
    self::assertArrayNotHasKey('accept', $author_form['actions'] ?? []);
    self::assertArrayNotHasKey('reject', $author_form['actions'] ?? []);
  }

  /**
   * Accept from the form publishes the same comment.
   */
  public function testAcceptPublishes(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($actors['assignee']);
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_comment', 'review');
    $form_object->setEntity($review);
    $form_state = new FormState();
    $form_state->setTriggeringElement(['#review_transition' => 'accept']);
    $form_object->save([], $form_state);
    $review = $this->reload($review);
    self::assertSame('accepted', (string) $review->get('review_state')->value);
    self::assertTrue($review->isPublished());
  }

  /**
   * A reviewer removed meanwhile gets an error from Submit review, not success.
   */
  public function testSubmitAfterRemovalReportsErrorAndKeepsDraft(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_comment', 'review');
    $form_object->setEntity($review);
    $form_state = new FormState();
    $form_state->setValues(['op' => 'Submit review']);
    // The editor removes the reviewer while their form is open.
    $actors['ticket']->set('reviewers', [])->save();
    $this->container->get('form_builder')->submitForm($form_object, $form_state);
    self::assertNotSame([], $form_state->getErrors());
    self::assertSame('draft', (string) $this->reload($review)->get('review_state')->value);
  }

  /**
   * A stale decision fails validation instead of overwriting the stored one.
   */
  public function testStaleDecisionFailsValidation(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($actors['assignee']);
    $stale = $this->reload($review);
    $winner = $this->reload($review);
    $this->applyReviewTransition($winner, 'reject');
    $winner->save();

    $this->applyReviewTransition($stale, 'accept');
    $messages = array_map(
      static fn($violation): string => (string) $violation->getMessage(),
      iterator_to_array($stale->validate()),
    );
    self::assertNotSame([], $messages);
    $stored = $this->reload($review);
    self::assertSame('rejected', (string) $stored->get('review_state')->value);
    self::assertFalse($stored->isPublished());
  }

  /**
   * A decision fails when the assignee changed after the ticket was read.
   */
  public function testDecisionFailsWhenTheAssigneeChangedMeanwhile(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($actors['assignee']);
    $review = $this->reload($review);
    // The ticket on the field item is read; then another request reassigns.
    self::assertNotNull($review->get('ticket_id')->entity);
    $this->container->get('database')->update('bb_ticket')
      ->fields(['assignee_user_id' => $actors['other']->id()])
      ->condition('id', $actors['ticket']->id())
      ->execute();
    $this->applyReviewTransition($review, 'accept');
    try {
      $review->save();
      self::fail('A stale assignee decided the review.');
    }
    catch (EntityStorageException $e) {
      self::assertStringContainsString('current assignee', $e->getMessage());
    }
    $stored = $this->reload($review);
    self::assertSame('submitted', (string) $stored->get('review_state')->value);
    self::assertFalse($stored->isPublished());
  }

  /**
   * Saving a draft that was submitted in another tab is a form error.
   */
  public function testSavingDraftSubmittedMeanwhileIsFormError(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_comment', 'review');
    $form_object->setEntity($review);
    $other_tab = $this->reload($review);
    $this->applyReviewTransition($other_tab, 'submit');
    $other_tab->save();
    $form_state = new FormState();
    $form_state->setValues(['op' => 'Save draft', 'body' => [['value' => 'late edit', 'format' => 'plain_text']]]);
    $this->container->get('form_builder')->submitForm($form_object, $form_state);
    self::assertNotSame([], $form_state->getErrors());
    $stored = $this->reload($review);
    self::assertSame('submitted', (string) $stored->get('review_state')->value);
    self::assertSame('draft body', (string) $stored->get('body')->value);
  }

  /**
   * A stale Save draft never resolves to the first rendered button, Accept.
   */
  public function testStaleSaveDraftDoesNotFallBackToAccept(): void {
    $actors = $this->actors();
    $actors['ticket']->set('reviewers', [$actors['reviewer']->id(), $actors['assignee']->id()])->save();
    $this->setCurrentUser($actors['assignee']);
    $review = $this->createReview($actors['ticket'], $actors['assignee']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_comment', 'review');
    $form_object->setEntity($this->reload($review));
    $form_state = new FormState();
    $form_state->setValues(['op' => 'Save draft']);
    // What core does on a real POST that matches no rendered button.
    $form_state->setTriggeringElement([
      '#type' => 'submit',
      '#name' => 'op',
      '#value' => 'Accept',
      '#review_transition' => 'accept',
      '#submit' => ['::submitForm', '::save'],
    ]);
    $this->container->get('form_builder')->submitForm($form_object, $form_state);
    self::assertNotSame([], $form_state->getErrors());
    $stored = $this->reload($review);
    self::assertSame('submitted', (string) $stored->get('review_state')->value);
    self::assertFalse($stored->isPublished());
  }

  /**
   * A draft save fails when another request submitted the review meanwhile.
   */
  public function testDraftSaveFailsWhenSubmittedMeanwhile(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->reload($this->createReview($actors['ticket'], $actors['reviewer']));
    $this->container->get('database')->update('bb_comment')
      ->fields(['review_state' => 'submitted'])
      ->condition('id', $review->id())
      ->execute();
    $review->set('body', ['value' => 'late edit', 'format' => 'plain_text']);
    try {
      $review->save();
      self::fail('A stale draft overwrote a submitted review.');
    }
    catch (EntityStorageException $e) {
      self::assertStringContainsString('changed meanwhile', $e->getMessage());
    }
    $stored = $this->reload($review);
    self::assertSame('submitted', (string) $stored->get('review_state')->value);
    self::assertSame('draft body', (string) $stored->get('body')->value);
  }

  /**
   * The review form shows only the body, without created or format help.
   */
  public function testFormShowsNoCreatedAndNoFormatHelp(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $form = $this->form($review);
    self::assertFalse($form['created']['#access'] ?? TRUE);
    $body = $form['body']['widget'][0] ?? [];
    foreach (['help', 'guidelines'] as $key) {
      self::assertFalse($body['format'][$key]['#access'] ?? FALSE, $key . ' is hidden.');
    }
  }

  /**
   * A dialog save closes the dialog by navigating back to the ticket.
   */
  public function testDialogSaveNavigatesBackToTheTicket(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $request = Request::create('/review', 'POST', ['_wrapper_format' => 'island_dialog']);
    $request->query->set('_wrapper_format', 'island_dialog');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_comment', 'review');
    $form_object->setEntity($review);
    $form_state = new FormState();
    $form_state->setTriggeringElement(['#submit_review' => TRUE]);
    $form_object->save([], $form_state);
    $response = $form_state->getResponse();
    self::assertNotNull($response);
    self::assertStringContainsString(
      $actors['ticket']->toUrl()->toString(),
      (string) $response->headers->get('HX-Location'),
    );
    self::assertSame('submitted', (string) $this->reload($review)->get('review_state')->value);
  }

  /**
   * Builds a workspace ticket with owner, assignee, reviewer and spare.
   *
   * @return array<string, mixed>
   *   Named accounts and the ticket.
   */
  private function actors(): array {
    $owner = $this->account('owner', ['update any bb_ticket']);
    $assignee = $this->account('assignee', ['update own bb_comment']);
    $reviewer = $this->account('reviewer', [
      'create bb_comment',
      'update own bb_comment',
      'delete own bb_comment',
    ]);
    $other = $this->account('other');
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'ws', 'slug' => 'ws-form']);
    $workspace->save();
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 't', 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'p',
        'group_id' => $group->id(),
        'teams' => [$team->id()],
      ]);
    $project->save();
    foreach ([$owner, $assignee, $other] as $account) {
      $this->addMembership($workspace, $account, ['contributor']);
      $this->addMembership($team, $account, ['member']);
    }
    $this->addMembership($workspace, $reviewer, ['guest']);
    $this->addMembership($team, $reviewer, ['member']);
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'title' => 'review-form',
        'workflow' => 'bb_work',
        'state' => 'todo',
        'project_id' => $project->id(),
        'owner_user_id' => $owner->id(),
        'assignee_user_id' => $assignee->id(),
        'reviewers' => [$reviewer->id()],
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return [
      'owner' => $owner,
      'assignee' => $assignee,
      'reviewer' => $reviewer,
      'other' => $other,
      'ticket' => $ticket,
    ];
  }

  /**
   * Creates a saved user with ticket and comment view.
   *
   * @param string $name
   *   Account name.
   * @param list<string> $extra
   *   Additional permissions.
   */
  private function account(string $name, array $extra = []): UserInterface {
    $account = $this->createUser([
      'view bb_ticket',
      'view bb_comment',
      ...$extra,
    ], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Creates a saved review draft.
   */
  private function createReview(BbTicketInterface $ticket, UserInterface $author): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'bundle' => 'review',
        'ticket_id' => $ticket->id(),
        'author' => $author->id(),
        'body' => ['value' => 'draft body', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();
    return $comment;
  }

  /**
   * Reloads a comment from storage.
   */
  private function reload(BbCommentInterface $comment): BbCommentInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $storage->resetCache([(string) $comment->id()]);
    $reloaded = $storage->load($comment->id());
    self::assertInstanceOf(BbCommentInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Builds the review form for one comment.
   *
   * @return array<string, mixed>
   *   The form render array.
   */
  private function form(BbCommentInterface $comment): array {
    $form_object = $this->container->get('entity_type.manager')
      ->getFormObject('bb_comment', 'review');
    $form_object->setEntity($comment);
    return $this->container->get('form_builder')->getForm($form_object);
  }

}
