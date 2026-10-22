<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\Combine;
use Drupal\views\Plugin\views\query\Sql;

/**
 * Core's combined-fields filter, with the LIKE escape clause it drops.
 *
 * Combine writes raw `LIKE` expressions and takes only the operator from
 * mapConditionOperator(), not its postfix. MySQL/MariaDB escape with a
 * backslash by default, SQLite only with an explicit `ESCAPE '\'`, so there a
 * search for "100%" or "under_score" compared the escaped backslashes literally
 * and matched nothing. Only "contains" is used by bakers.build's listings (and
 * core's people admin view); the other operators are left as core has them.
 * Replaces `combine` through the Views data (EntitySchemaHooks).
 */
#[ViewsFilter('bb_combine')]
final class BbCombine extends Combine {

  /**
   * {@inheritdoc}
   *
   * @param string $expression
   *   The SQL expression of the combined fields.
   */
  protected function opContains($expression): void {
    if (!$this->query instanceof Sql) {
      parent::opContains($expression);
      return;
    }
    $placeholder = $this->placeholder();
    $mapping = $this->connection->mapConditionOperator('LIKE');
    $operator = $mapping['operator'] ?? 'LIKE';
    $postfix = $mapping['postfix'] ?? '';
    $this->query->addWhereExpression(
      $this->options['group'],
      "$expression $operator $placeholder$postfix",
      [$placeholder => '%' . $this->connection->escapeLike($this->value) . '%'],
    );
  }

}
