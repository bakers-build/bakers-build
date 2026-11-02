<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use Drupal\bb_core\Link\LinkKind;
use Drupal\bb_core\Ticket\TicketLinkGroups;
use PHPUnit\Framework\Attributes\Group;

/**
 * The band's four link groups, grouped off `LinkKind` (BB-414 D5).
 *
 * THE GROUPING NEEDS NO NEW FIELD AND NO AGENT CONVENTION.
 * `LinkKind::fromUri()` already runs in `BbTicket::preSave()` through
 * `LinkNormalizer::normalize()`
 * and writes `options.bakers.kind`, and its values are exactly
 * `link-group`'s `kind` enum (F8). So the map from kind to group is one
 * constant on one class, and everything else is already stored.
 *
 * THIS IS A PURE MAPPER, which is why it is a unit test and not a kernel one.
 * It takes the raw `links` field value — the list of `{uri, title, options}`
 * arrays `$ticket->get('links')->getValue()` returns — and gives back render
 * arrays. Nothing here loads an entity, reaches the container or issues a
 * request, and `testAnyReportRowIssuesNoRequestOfItsOwn()` is that last claim
 * asserted rather than assumed.
 */
#[Group('bb_core')]
final class TicketLinkGroupsTest extends UnitTestCase {

  /**
   * The four group labels, in the order the band lays them out.
   *
   * @var array<string>
   */
  private const LABELS = ['Code', 'Test results', 'Try it yourself', 'More'];

  /**
   * All kinds land in four groups, in the fixed order.
   */
  public function testTheFourGroupsInTheirFixedOrder(): void {
    $groups = TicketLinkGroups::build($this->oneLinkPerKind());

    self::assertSame(self::LABELS, $this->labels($groups));
  }

  /**
   * Every kind lands in the group the design assigns it.
   *
   * Asserted as the whole partition rather than one kind at a time: a mapper
   * that dropped a kind, or put one in two groups, passes every single-kind
   * check and fails this one.
   */
  public function testEachKindLandsInItsOwnGroup(): void {
    $groups = TicketLinkGroups::build($this->oneLinkPerKind());

    self::assertSame(
      [
        'Code' => [LinkKind::MR, LinkKind::BRANCH],
        'Test results' => [LinkKind::CI, LinkKind::REPORT],
        'Try it yourself' => [LinkKind::DDEV, LinkKind::DESIGN],
        'More' => [LinkKind::DOC, LinkKind::CHAT],
      ],
      $this->kindsByLabel($groups),
    );
  }

  /**
   * Each group is a `bb_theme:link-group` and carries its rows as a prop.
   */
  public function testEachGroupIsTheLinkGroupComponent(): void {
    foreach (TicketLinkGroups::build($this->oneLinkPerKind()) as $group) {
      self::assertSame('component', $group['#type']);
      self::assertSame('bb_theme:link-group', $group['#component']);
      self::assertNotEmpty($group['#props']['links']);
    }
  }

  /**
   * A group with no rows renders NOTHING — not an empty group with a label.
   *
   * "A group with a promising label and no rows is worse than an absent one",
   * as the component itself puts it.
   */
  public function testAnyGroupWithNoRowsIsAbsentEntirely(): void {
    $groups = TicketLinkGroups::build([
      $this->link('https://gitlab.example.com/g/g/-/merge_requests/88', 'MR !88'),
    ]);

    self::assertSame(['Code'], $this->labels($groups));
  }

  /**
   * No links at all is no groups at all.
   */
  public function testNoLinksProduceNoGroups(): void {
    self::assertSame([], TicketLinkGroups::build([]));
  }

  /**
   * A row keeps the field's order inside its group.
   */
  public function testRowsKeepTheFieldOrderWithinOneGroup(): void {
    $groups = TicketLinkGroups::build([
      $this->link('https://gitlab.example.com/g/g/-/tree/feat/x', 'branch first'),
      $this->link('https://gitlab.example.com/g/g/-/merge_requests/88', 'mr second'),
    ]);

    self::assertSame(
      ['branch first', 'mr second'],
      array_column($groups[0]['#props']['links'], 'title'),
    );
  }

  /**
   * An UNKNOWN stored kind falls back to the URI classification.
   *
   * The stored kind is authoritative when it is one of the known kinds; a value from
   * before normalisation existed, or one an import wrote by hand, is not
   * allowed to invent a new group or to vanish from the band.
   */
  public function testAnUnknownStoredKindFallsBackToTheUri(): void {
    $groups = TicketLinkGroups::build([
      $this->link(
        'https://gitlab.example.com/g/g/-/merge_requests/88',
        'MR !88',
        ['bakers' => ['kind' => 'nonsense']],
      ),
    ]);

    self::assertSame(['Code'], $this->labels($groups));
    self::assertSame(LinkKind::MR, $groups[0]['#props']['links'][0]['kind']);
  }

  /**
   * A MISSING kind — a link stored before normalisation — falls back too.
   */
  public function testAnyMissingStoredKindFallsBackToTheUri(): void {
    $groups = TicketLinkGroups::build([
      ['uri' => 'https://gitlab.example.com/g/g/-/pipelines/48213', 'title' => 'Pipeline'],
    ]);

    self::assertSame(['Test results'], $this->labels($groups));
    self::assertSame(LinkKind::CI, $groups[0]['#props']['links'][0]['kind']);
  }

  /**
   * The stored kind WINS over the URI when it is a valid one.
   *
   * The negative control for the two fallbacks above: without it they would
   * also pass against a mapper that ignored `options.bakers.kind` entirely and
   * re-derived every kind, which would throw away a classification a future
   * importer may set deliberately.
   */
  public function testAnyValidStoredKindWinsOverTheUri(): void {
    $groups = TicketLinkGroups::build([
      $this->link(
        'https://example.com/anything',
        'A design artefact',
        ['bakers' => ['kind' => LinkKind::DESIGN]],
      ),
    ]);

    self::assertSame(['Try it yourself'], $this->labels($groups));
    self::assertSame(LinkKind::DESIGN, $groups[0]['#props']['links'][0]['kind']);
  }

  /**
   * A `report` row carries ONLY the counts its props carry — today, none.
   *
   * No field carries `passed`, `failed` or `duration`, so this holds trivially.
   * It is asserted anyway because it IS the acceptance criterion: a mapper that
   * invented zeroes, or that fetched the artifact to count for itself, would
   * satisfy every other test here.
   */
  public function testAnyReportRowWithoutCountsCarriesNone(): void {
    $groups = TicketLinkGroups::build([
      $this->link(
        'https://gitlab.example.com/g/g/-/jobs/1/artifacts/file/playwright-report/index.html',
        'Playwright BDD report',
      ),
    ]);
    $row = $groups[0]['#props']['links'][0];

    self::assertSame(['url', 'title', 'kind'], array_keys($row));
    foreach (['passed', 'failed', 'duration'] as $count) {
      self::assertArrayNotHasKey($count, $row);
    }
  }

  /**
   * A `report` row issues NO request of its own.
   *
   * The component says the same of itself, and the reason is worth keeping in
   * front of a reader: a real report-artifact reader needs a fetch, credentials
   * a cache and a failure path, and the GitLab credentials live on the
   * conductor's machine rather than on the control plane. So the mapper must
   * not smuggle one in through the render array either — no lazy builder, no
   * pre-render callback, nothing attached.
   *
   * ASSERTED ON THE ROW, NOT ONLY ON THE GROUP. The first version of this test
   * looked at `$groups[0]` alone, which is the `link-group` component — a
   * render array whose only interesting keys are `#type`, `#component` and
   * `#props`. A lazy builder smuggled into the ROW inside `#props.links` would
   * have passed it, and the row is precisely where a report-artifact reader
   * would be put. Both levels are checked now, and the row is checked
   * exhaustively rather than against a list of four names: a row is data, so
   * ANY `#`-prefixed key in it is a render directive that does not belong.
   */
  public function testAnyReportRowIssuesNoRequestOfItsOwn(): void {
    $groups = TicketLinkGroups::build([
      $this->link(
        'https://gitlab.example.com/g/g/-/jobs/1/artifacts/file/playwright-report/index.html',
        'Playwright BDD report',
      ),
    ]);

    foreach (['#lazy_builder', '#pre_render', '#post_render', '#attached'] as $key) {
      self::assertArrayNotHasKey($key, $groups[0]);
      self::assertArrayNotHasKey($key, $groups[0]['#props']['links'][0]);
    }
    foreach (array_keys($groups[0]['#props']['links'][0]) as $key) {
      self::assertStringStartsNotWith('#', (string) $key);
    }
  }

  /**
   * The counts ARE passed through when the props carry them.
   *
   * The other half of "only the counts its props carry": the row must render
   * what it is given, so that the day a field carries the counts the band shows
   * them without a second decision. Nothing writes these today.
   */
  public function testAnyReportRowPassesThroughTheCountsItsPropsCarry(): void {
    $groups = TicketLinkGroups::build([
      $this->link(
        'https://gitlab.example.com/g/g/-/jobs/1/artifacts/file/playwright-report/index.html',
        'Playwright BDD report',
        ['bakers' => ['kind' => LinkKind::REPORT, 'passed' => 46, 'failed' => 2, 'duration' => '3m 41s']],
      ),
    ]);
    $row = $groups[0]['#props']['links'][0];

    self::assertSame(46, $row['passed']);
    self::assertSame(2, $row['failed']);
    self::assertSame('3m 41s', $row['duration']);
  }

  /**
   * Counts on a NON-report row are dropped — they have nowhere to render.
   */
  public function testCountsOnAnyNonReportRowAreDropped(): void {
    $groups = TicketLinkGroups::build([
      $this->link(
        'https://gitlab.example.com/g/g/-/merge_requests/88',
        'MR !88',
        ['bakers' => ['kind' => LinkKind::MR, 'passed' => 46]],
      ),
    ]);

    self::assertSame(['url', 'title', 'kind'], array_keys($groups[0]['#props']['links'][0]));
  }

  /**
   * One link of every kind, in an order that is not the group order.
   *
   * @return array<array<string, mixed>>
   *   A raw `links` field value.
   */
  private function oneLinkPerKind(): array {
    return [
      $this->link('https://example.com/readme', 'Docs', ['bakers' => ['kind' => LinkKind::DOC]]),
      $this->link('https://gitlab.example.com/g/g/-/merge_requests/88', 'MR !88'),
      $this->link('https://bb-142.ddev.site/admin/bakers/tickets', 'Worktree'),
      $this->link('https://gitlab.example.com/g/g/-/pipelines/48213', 'Pipeline'),
      $this->link('https://example.com/designbook/index.html', 'Designbook'),
      $this->link('https://gitlab.example.com/g/g/-/tree/feat/x', 'Branch'),
      $this->link('https://gitlab.example.com/g/g/-/jobs/1/artifacts/file/r/index.html', 'Report'),
      $this->link('https://acme.slack.com/archives/C0123ABCD/p1700000000000100', 'Slack thread'),
    ];
  }

  /**
   * One raw link-field item, classified the way `preSave()` would classify it.
   *
   * @param string $uri
   *   The link URI.
   * @param string $title
   *   The link title.
   * @param array<string, mixed>|null $options
   *   The stored options, or NULL to derive them as `LinkNormalizer` does.
   *
   * @return array<string, mixed>
   *   The raw field item.
   */
  private function link(string $uri, string $title, ?array $options = NULL): array {
    return [
      'uri' => $uri,
      'title' => $title,
      'options' => $options ?? ['bakers' => ['kind' => LinkKind::fromUri($uri)]],
    ];
  }

  /**
   * The group labels of a built band, in order.
   *
   * @param array<array<mixed>> $groups
   *   The built link groups.
   *
   * @return array<string>
   *   The labels.
   */
  private function labels(array $groups): array {
    return array_map(
      static fn(array $group): string => (string) $group['#props']['label'],
      $groups,
    );
  }

  /**
   * The kinds each group holds, keyed by group label.
   *
   * @param array<array<mixed>> $groups
   *   The built link groups.
   *
   * @return array<string, array<string>>
   *   Kinds per label.
   */
  private function kindsByLabel(array $groups): array {
    $map = [];
    foreach ($groups as $group) {
      $map[(string) $group['#props']['label']] = array_column($group['#props']['links'], 'kind');
    }
    return $map;
  }

}
