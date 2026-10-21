<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Plugin\views\filter;

use Drupal\Core\Form\FormStateInterface;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\FilterPluginBase;
use Drupal\views\Plugin\views\query\Sql;

/**
 * Keeps one row per (workspace, name): the newest by `created`, then `id`.
 *
 * A row passes when no row of the same workspace and name is newer, so the
 * result is one entity per workspace/name and nothing is aggregated in PHP.
 * The workspace clause (BB-660/661) is load-bearing: without it, two
 * unrelated workspaces registering the same addon name would compete for
 * "newest" and one workspace's row would silently suppress the other's.
 */
#[ViewsFilter('bb_addon_newest_per_name')]
final class AddonNewestPerName extends FilterPluginBase {

  /**
   * {@inheritdoc}
   *
   * @var bool
   */
  // phpcs:ignore Drupal.NamingConventions.ValidVariableName.LowerCamelName
  public $no_operator = TRUE;

  /**
   * {@inheritdoc}
   */
  public function adminSummary(): string {
    return '';
  }

  /**
   * {@inheritdoc}
   */
  protected function valueForm(&$form, FormStateInterface $form_state): void {
    $form['value'] = [];
  }

  /**
   * {@inheritdoc}
   */
  public function canExpose(): bool {
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    if (!$this->query instanceof Sql) {
      return;
    }
    $table = $this->ensureMyTable();
    $this->query->addWhereExpression(
      $this->options['group'],
      "NOT EXISTS (SELECT 1 FROM {bb_addon} newer WHERE newer.name = $table.name"
      . " AND newer.workspace_id = $table.workspace_id"
      . " AND (newer.created > $table.created OR (newer.created = $table.created AND newer.id > $table.id)))",
    );
  }

}
