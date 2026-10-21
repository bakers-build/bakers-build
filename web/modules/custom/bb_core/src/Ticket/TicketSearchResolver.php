<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\search_api\Entity\Index;
use Drupal\search_api\Query\QueryInterface;

/**
 * Turns one typed search line into the condition a ticket search applies.
 *
 * This is the only place the grammar lives. The web list's exposed filter
 * applies it to the ticket index; the JSON:API collection looks the same
 * line up on that index and filters by the matching ids.
 */
final class TicketSearchResolver {

  use StringTranslationTrait;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbWorkspaceReadScopeInterface $readScope,
    private readonly AccountInterface $currentUser,
  ) {}

  /**
   * Classifies one input line.
   *
   * @param string $input
   *   What the person typed.
   * @param \Drupal\bb_core\Entity\BbProjectInterface|null $project
   *   The project in context, when there is one. A bare `#19` resolves against
   *   its repository.
   */
  public function resolve(string $input, ?BbProjectInterface $project = NULL): TicketSearchQuery {
    $input = trim($input);
    if ($input === '') {
      return new TicketSearchQuery();
    }

    if (preg_match('#^[A-Za-z][A-Za-z0-9]*-\d+$#', $input)) {
      return new TicketSearchQuery(field: 'identifier', value: mb_strtoupper($input));
    }

    $reference = OriginReference::fromUrl($input);
    if ($reference !== NULL) {
      return new TicketSearchQuery(field: 'origin_ref', value: $reference->key());
    }

    $short = OriginReference::parseShortReference($input);
    if ($short !== NULL) {
      return $this->resolveShortReference($short['alias'], $short['number'], $project);
    }

    if (preg_match('#^\d+$#', $input)) {
      return $this->resolveBareNumber($input, $project);
    }

    return new TicketSearchQuery(fulltext: $input);
  }

  /**
   * Resolves a typed decimal number to identifier `KEY-n`.
   *
   * With a project in context that is an exact match. Without one, it is
   * every readable project's `KEY-n`. No readable project (or a project
   * without a key) is an honest empty result, not free text over the title.
   */
  private function resolveBareNumber(string $number, ?BbProjectInterface $project): TicketSearchQuery {
    if ($project !== NULL) {
      $key = $project->getKey();
      return new TicketSearchQuery(
        field: 'identifier',
        value: $key === '' ? [] : $key . '-' . $number,
      );
    }

    $identifiers = [];
    foreach ($this->readableProjects() as $candidate) {
      if (!$candidate instanceof BbProjectInterface) {
        continue;
      }
      $key = $candidate->getKey();
      if ($key !== '') {
        $identifiers[] = $key . '-' . $number;
      }
    }
    sort($identifiers);
    return new TicketSearchQuery(field: 'identifier', value: $identifiers);
  }

  /**
   * Applies one resolved line to a Search API query.
   *
   * Same conditions the web list's exposed filter applies: an exact or IN
   * comparison on `identifier` / `origin_ref`, or fulltext over `title`.
   */
  public function apply(QueryInterface $query, TicketSearchQuery $resolved): void {
    if ($resolved->isEmpty() || $resolved->failed()) {
      return;
    }
    if ($resolved->field !== NULL) {
      $values = $resolved->value;
      $operator = is_array($values) ? 'IN' : '=';
      if ($values === [] || $values === NULL || $values === '') {
        $query->abort();
        return;
      }
      $query->addCondition($resolved->field, $values, $operator);
      return;
    }
    $query->setFulltextFields(['title']);
    $query->keys((string) $resolved->fulltext);
  }

  /**
   * Ticket ids matching the resolved line, via the ticket index.
   *
   * @return int[]
   *   Ticket ids; the index's read-scope processor narrows them. Empty when
   *   the index is missing, the query aborts, or nothing matches.
   */
  public function ticketIds(TicketSearchQuery $resolved): array {
    if ($resolved->isEmpty() || $resolved->failed()) {
      return [];
    }
    $index = Index::load('bb_tickets');
    if ($index === NULL || !$index->status()) {
      return [];
    }
    $query = $index->query();
    $this->apply($query, $resolved);
    return $this->idsFrom($query);
  }

  /**
   * The ids of the tickets the account may read whose origin has this key.
   *
   * @return int[]
   *   Ticket ids; the index's read-scope processor narrows them.
   */
  public function ticketIdsForOrigin(string $originKey): array {
    return $this->ticketIds(new TicketSearchQuery(field: 'origin_ref', value: $originKey));
  }

  /**
   * Entity ids from one executed index query.
   *
   * @return int[]
   *   Unique ticket ids.
   */
  private function idsFrom(QueryInterface $query): array {
    $ids = [];
    foreach ($query->execute()->getResultItems() as $item) {
      // `entity:bb_ticket/<id>:<langcode>`.
      if (preg_match('#/(\d+):#', (string) $item->getId(), $matches)) {
        $ids[] = (int) $matches[1];
      }
    }
    return array_values(array_unique($ids));
  }

  /**
   * Resolves `#19` / `alias#19` against the repositories in reach.
   */
  private function resolveShortReference(?string $alias, int $number, ?BbProjectInterface $project): TicketSearchQuery {
    $repositories = $this->repositories($project);

    if ($alias === NULL) {
      // No alias: only a single candidate is unambiguous.
      if (count($repositories) === 1) {
        return $this->resolveAlias((string) array_key_first($repositories), reset($repositories), $number);
      }
      if ($repositories === []) {
        return new TicketSearchQuery(
          error: (string) $this->t('"#@number" names no repository, and none is configured on your projects.', ['@number' => $number]),
        );
      }
      return new TicketSearchQuery(
        error: (string) $this->t('"#@number" is ambiguous — name the repository, for example @example. Known in your projects: @list.', [
          '@number' => $number,
          '@example' => array_key_first($repositories) . '#' . $number,
          '@list' => implode(', ', array_keys($repositories)),
        ]),
        candidates: array_keys($repositories),
      );
    }

    if (isset($repositories[$alias])) {
      return $this->resolveAlias($alias, $repositories[$alias], $number);
    }

    $matches = array_filter(
      $repositories,
      static fn (string $candidate): bool => str_starts_with($candidate, $alias),
      ARRAY_FILTER_USE_KEY,
    );
    if (count($matches) === 1) {
      return $this->resolveAlias((string) array_key_first($matches), reset($matches), $number);
    }
    if ($matches !== []) {
      return new TicketSearchQuery(
        error: (string) $this->t('"@alias" is ambiguous — matching repositories: @list. Give the full repository name.', [
          '@alias' => $alias,
          '@list' => implode(', ', array_keys($matches)),
        ]),
        candidates: array_keys($matches),
      );
    }
    return new TicketSearchQuery(
      error: (string) $this->t('No repository matches "@alias". Known in your projects: @list.', [
        '@alias' => $alias,
        '@list' => $repositories === [] ? (string) $this->t('none') : implode(', ', array_keys($repositories)),
      ]),
      candidates: array_keys($repositories),
    );
  }

  /**
   * Resolves one alias, which several repositories may share.
   *
   * @param string $alias
   *   The alias, for the message.
   * @param string[] $paths
   *   The repository paths behind the alias.
   * @param int $number
   *   The issue number.
   */
  private function resolveAlias(string $alias, array $paths, int $number): TicketSearchQuery {
    if (count($paths) === 1) {
      return new TicketSearchQuery(field: 'origin_ref', value: OriginReference::keyFor(reset($paths), $number));
    }
    return new TicketSearchQuery(
      error: (string) $this->t('"@alias" names several repositories: @list. Search by the issue URL instead.', [
        '@alias' => $alias,
        '@list' => implode(', ', $paths),
      ]),
      candidates: $paths,
    );
  }

  /**
   * The repositories in reach, keyed by alias, valued by repository paths.
   *
   * Scoped to the project in context when there is one, otherwise to every
   * project the account may read — the same read scope the index applies, so
   * an alias never names a repository whose tickets the account cannot see.
   *
   * @return array<string, string[]>
   *   Alias to its sorted repository paths — two repositories can share a
   *   last path segment — sorted by alias.
   */
  private function repositories(?BbProjectInterface $project): array {
    $repositories = [];
    foreach ($project !== NULL ? [$project] : $this->readableProjects() as $candidate) {
      if (!$candidate instanceof BbProjectInterface) {
        continue;
      }
      $url = (string) $candidate->get('repository')->url;
      $alias = OriginReference::aliasOf($url);
      $path = OriginReference::pathOf($url);
      if ($alias !== NULL && $path !== NULL) {
        $repositories[$alias][$path] = $path;
      }
    }
    ksort($repositories);
    return array_map(static function (array $paths): array {
      sort($paths);
      return $paths;
    }, $repositories);
  }

  /**
   * Every project the current account may read.
   *
   * @return \Drupal\Core\Entity\EntityInterface[]
   *   The projects.
   */
  private function readableProjects(): array {
    $storage = $this->entityTypeManager->getStorage('bb_project');
    if ($this->readScope->isBypassed($this->currentUser, 'bb_project')) {
      return $storage->loadMultiple();
    }
    $ids = $this->readScope->projectIds($this->currentUser);
    return $ids === [] ? [] : $storage->loadMultiple(array_values($ids));
  }

}
