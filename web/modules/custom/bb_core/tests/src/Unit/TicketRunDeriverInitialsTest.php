<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Derive\TicketRunDeriver;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests TicketRunDeriver::initials() through the real assignee() path.
 *
 * BB-299 D7: a one-word display name must not collapse to a single letter in
 * the WHO column — it yields the word's first TWO characters, uppercased
 * (`cw` → `CW`). Two-or-more words keep today's first-letter-per-word rule
 * (of the first two words), and a one-character name yields one character (no
 * characters are invented). This is the fallback CommentAuthorInitialsItemList
 * already ships, applied to the assignee side.
 */
#[Group('bb_core')]
final class TicketRunDeriverInitialsTest extends UnitTestCase {

  /**
   * The initials rule, driven through assignee() with a real field read.
   */
  #[DataProvider('initialsData')]
  public function testAssigneeInitials(string $displayName, string $expected): void {
    $account = $this->createMock(AccountInterface::class);
    $account->method('getDisplayName')->willReturn($displayName);
    $account->method('id')->willReturn(1);

    $field = $this->createMock(FieldItemListInterface::class);
    $field->method('isEmpty')->willReturn(FALSE);
    $field->method('__get')->with('entity')->willReturn($account);

    $ticket = $this->createMock(BbTicketInterface::class);
    $ticket->method('get')->with('assignee_user_id')->willReturn($field);

    $deriver = new TicketRunDeriver(
      $this->createMock(EntityTypeManagerInterface::class),
      $this->createMock(TimeInterface::class),
      $this->createMock(DateFormatterInterface::class),
    );

    $this->assertSame($expected, $deriver->assignee($ticket)['initials']);
  }

  /**
   * Display names and their initials.
   *
   * @return iterable<string, array{string, string}>
   *   Test cases keyed by a readable label.
   */
  public static function initialsData(): iterable {
    yield 'one word, two chars' => ['cw', 'CW'];
    yield 'one word, long' => ['christoph', 'CH'];
    yield 'two words' => ['Christoph Weber', 'CW'];
    yield 'three words takes the first two' => ['Anna Maria Foo', 'AM'];
    yield 'single character name' => ['c', 'C'];
    yield 'empty' => ['', ''];
  }

}
