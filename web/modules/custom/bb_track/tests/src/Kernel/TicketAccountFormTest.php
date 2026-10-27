<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Form\FormState;
use Drupal\Core\Lock\DatabaseLockBackend;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Access\TicketAccountAccess;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Form\TicketAccountForm;
use Drupal\bb_track\WorkAssignments;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DependencyInjection\Reference;

/**
 * The ticket inspector's Billing row: origin for viewers, picker for editors.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class TicketAccountFormTest extends WorkTimeTestBase {

  /**
   * {@inheritdoc}
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    // A real lock, so a second holder can keep the account lock busy.
    $container->register('lock', DatabaseLockBackend::class)->addArgument(new Reference('database'));
  }

  /**
   * The row names the account and its origin, for any viewer.
   */
  public function testRowNamesAccountAndOrigin(): void {
    [$epic, $child] = $this->epicAndChild();
    self::assertSame(['Project work', 'project default'], $this->row($child));
    $account = $this->account('Kunde X');
    $this->assignments()->linkTicket((int) $epic->id(), (int) $account->id(), 0);
    self::assertSame(['Kunde X', 'from ' . $epic->getIdentifier()], $this->row($child));
    self::assertSame(['Kunde X', 'linked'], $this->row($epic));
    // A viewer without recording or update rights reads the same row.
    $this->container->get('current_user')->setAccount($this->peer);
    self::assertSame(['Kunde X', 'linked'], $this->row($epic));
  }

  /**
   * The editor's picker offers linkable accounts only, never the default.
   */
  public function testPickerOffersLinkableAccountsOnly(): void {
    [$epic] = $this->epicAndChild();
    $account = $this->account('Kunde X');
    $form = $this->container->get('form_builder')->getForm(TicketAccountForm::class, $epic);
    $cell = $form['row']['#slots']['content']['#props']['items'][0]['cells']['value'];
    self::assertSame('picker', $cell['kind']);
    self::assertSame([(string) $account->id()], array_column($cell['options'], 'value'));
    self::assertSame(['HARV-Kunde X'], array_column($cell['options'], 'description'));
    self::assertSame(['Project work'], $cell['value_labels']);
  }

  /**
   * An account without an external ID gets an empty option description.
   */
  public function testPickerDescriptionIsTheExternalId(): void {
    [$epic] = $this->epicAndChild();
    $plain = $this->assignments()->saveAccount((int) $this->project->id(), ['name' => 'Plain']);
    $form = $this->container->get('form_builder')->getForm(TicketAccountForm::class, $epic);
    $cell = $form['row']['#slots']['content']['#props']['items'][0]['cells']['value'];
    self::assertSame([(string) $plain->id() => ''], array_column($cell['options'], 'description', 'value'));
  }

  /**
   * Save links the ticket, an empty pick inherits again.
   */
  public function testSaveLinksAndInherits(): void {
    [$epic, $child] = $this->epicAndChild();
    $account = $this->account('Kunde X');
    $this->submit($epic, [(string) $account->id()], '0');
    self::assertSame([(int) $epic->id()], WorkAssignments::linkedTickets($this->reload($account)));
    self::assertSame(
      (int) $account->id(),
      $this->assignments()->assignment((int) $this->project->id(), (int) $child->id())['id'],
    );
    $this->submit($epic, [], (string) $account->id());
    self::assertSame([], WorkAssignments::linkedTickets($this->reload($account)));
    self::assertTrue((bool) $this->reload($account)->get('active')->value);
    self::assertSame(
      $this->accountId,
      $this->assignments()->assignment((int) $this->project->id(), (int) $child->id())['id'],
    );
  }

  /**
   * Without JavaScript the native choice wins over the picker's value.
   */
  public function testNativeChoiceWinsWithoutJavaScript(): void {
    [$epic] = $this->epicAndChild();
    $account = $this->account('Kunde X');
    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$epic]);
    $form_state->setValues([
      'billing_account' => [],
      'billing_account_nojs' => (string) $account->id(),
      'shown' => '0',
      'op' => 'Save billing account',
    ]);
    $this->container->get('form_builder')->submitForm(TicketAccountForm::class, $form_state);
    self::assertSame([(int) $epic->id()], WorkAssignments::linkedTickets($this->reload($account)));
  }

  /**
   * Showing the row and the picker leaves other cached entities alone.
   */
  public function testRenderingKeepsTheEntityCache(): void {
    [$epic] = $this->epicAndChild();
    $this->account('Kunde X');
    $cache = $this->container->get('cache.entity');
    $cache->set('values:sentinel:1', 'kept');
    $this->row($epic);
    $this->container->get('form_builder')->getForm(TicketAccountForm::class, $epic);
    self::assertNotFalse($cache->get('values:sentinel:1'));
  }

  /**
   * A pick made on a page that showed an older link writes nothing.
   */
  public function testStaleSaveKeepsTheNewerLink(): void {
    [$epic] = $this->epicAndChild();
    $first = $this->account('Kunde X');
    $second = $this->account('Kunde Y');
    // Another tab linked the first account after this page showed none.
    $this->assignments()->linkTicket((int) $epic->id(), (int) $first->id(), 0);
    $this->submit($epic, [(string) $second->id()], '0');
    self::assertArrayHasKey('error', $this->container->get('messenger')->deleteAll());
    self::assertSame([(int) $epic->id()], WorkAssignments::linkedTickets($this->reload($first)));
    self::assertSame([], WorkAssignments::linkedTickets($this->reload($second)));
  }

  /**
   * A busy account lock is a message, not an error page.
   */
  public function testBusyLockShowsMessage(): void {
    if ($this->container->get('database')->driver() === 'mysql') {
      // WorkTimeMutation uses GET_LOCK there, not the lock service.
      self::markTestSkipped('Holds the lock through the lock service only.');
    }
    [$epic] = $this->epicAndChild();
    $account = $this->account('Kunde X');
    $other_request = new DatabaseLockBackend($this->container->get('database'));
    self::assertTrue($other_request->acquire('bb_track:assignments'));
    $this->submit($epic, [(string) $account->id()], '0');
    $other_request->release('bb_track:assignments');
    self::assertArrayHasKey('error', $this->container->get('messenger')->deleteAll());
    self::assertSame([], WorkAssignments::linkedTickets($this->reload($account)));
  }

  /**
   * A closed ticket is read-only: no link for the editor either.
   *
   * The inspector source offers the picker on exactly this access.
   */
  public function testClosedTicketOffersNoPicker(): void {
    [$epic] = $this->epicAndChild();
    $this->account('Kunde X');
    self::assertTrue(TicketAccountAccess::link($epic, $this->employee)->isAllowed());
    $epic->set('closed', TRUE);
    self::assertFalse(TicketAccountAccess::link($epic, $this->employee)->isAllowed());
  }

  /**
   * A contributor posting directly changes nothing.
   */
  public function testContributorPostIsDenied(): void {
    [$epic] = $this->epicAndChild();
    $account = $this->account('Kunde X');
    $this->container->get('current_user')->setAccount($this->peer);
    $this->submit($epic, [(string) $account->id()], '0');
    self::assertArrayHasKey('error', $this->container->get('messenger')->deleteAll());
    self::assertSame([], WorkAssignments::linkedTickets($this->reload($account)));
  }

  /**
   * The read-only row's value and origin badge.
   *
   * @return list<string>
   *   The value text, then the origin label.
   */
  private function row(BbTicketInterface $ticket): array {
    $ticket_storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $built = TicketAccountForm::row($ticket, $this->assignments(), $ticket_storage);
    $items = $built['#slots']['content']['#props']['items'];
    return [$items[0]['cells']['value']['value'], $items[1]['cells']['value']['label']];
  }

  /**
   * Submits the Billing row of a ticket.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param list<string> $picked
   *   The picked account id, or none for Inherit.
   * @param string $shown
   *   The linked account id the form showed, '0' for none.
   */
  private function submit(BbTicketInterface $ticket, array $picked, string $shown): void {
    $form_state = new FormState();
    $form_state->addBuildInfo('args', [$ticket]);
    $form_state->setValues(['billing_account' => $picked, 'shown' => $shown, 'op' => 'Save billing account']);
    $this->container->get('form_builder')->submitForm(TicketAccountForm::class, $form_state);
  }

  /**
   * A new active, unlinked account of the fixture project.
   */
  private function account(string $name): Account {
    return $this->assignments()->saveAccount(
      (int) $this->project->id(),
      ['name' => $name, 'external_id' => 'HARV-' . $name],
    );
  }

  /**
   * The account as stored now.
   */
  private function reload(Account $account): Account {
    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_track_account')
      ->loadUnchanged($account->id());
    assert($reloaded instanceof Account);
    return $reloaded;
  }

  /**
   * The assignments service.
   */
  private function assignments(): WorkAssignments {
    return $this->container->get('bb_track.assignments');
  }

  /**
   * An epic and a child ticket in the fixture project.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbTicketInterface, 1: \Drupal\bb_core\Entity\BbTicketInterface}
   *   The epic, then the child.
   */
  private function epicAndChild(): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $epic = $storage->create(['title' => 'Epic', 'project_id' => $this->project->id(), 'workflow' => 'bb_work']);
    $epic->save();
    $child = $storage->create([
      'title' => 'Child',
      'project_id' => $this->project->id(),
      'parent_id' => $epic->id(),
      'workflow' => 'bb_work',
    ]);
    $child->save();
    assert($epic instanceof BbTicketInterface && $child instanceof BbTicketInterface);
    return [$epic, $child];
  }

}
