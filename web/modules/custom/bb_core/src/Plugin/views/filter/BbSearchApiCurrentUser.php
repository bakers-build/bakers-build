<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\search_api\Plugin\views\SearchApiHandlerTrait;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\FilterPluginBase;

/**
 * Narrows a Search API view to rows whose user reference is the reader.
 *
 * Not a `user` default argument: the path's `%bb_workspace` segment already
 * owns argument position 0. Not core's `user_current` either: that writes a SQL
 * placeholder a Search API query never substitutes. The account is the view's
 * (`ViewExecutable::getUser()`), so `setUser()` in tests and previews applies.
 * No operator and not exposable: it is a property of the display, and an
 * exposed filter would render as a removable chip.
 */
#[ViewsFilter('bb_search_api_current_user')]
final class BbSearchApiCurrentUser extends FilterPluginBase {

  use SearchApiHandlerTrait;

  /**
   * {@inheritdoc}
   *
   * The name is core's — `FilterPluginBase` declares it in snake_case and reads
   * it in `buildOptionsForm()` to decide whether to offer an operator select.
   * Renaming it would leave the parent's read pointing at nothing.
   *
   * @var bool
   */
  // phpcs:ignore Drupal.NamingConventions.ValidVariableName.LowerCamelName
  public $no_operator = TRUE;

  /**
   * {@inheritdoc}
   */
  public function canExpose(): bool {
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  public function adminSummary(): string {
    return (string) $this->t('is the current user');
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    $query = $this->getQuery();
    if ($query === NULL) {
      // Not a Search API query: this filter has nothing it can say, and saying
      // nothing is safer than writing a condition the backend will mangle.
      return;
    }
    $query->addCondition(
      $this->realField,
      (int) $this->view->getUser()->id(),
      '=',
      $this->options['group'],
    );
  }

  /**
   * {@inheritdoc}
   *
   * The result depends on who is asking, so the render cache has to key on it.
   * Without this the first reader's list is served to the second, which is the
   * one defect of this filter that no functional test would notice.
   *
   * @return array<string>
   *   The cache contexts.
   */
  public function getCacheContexts() {
    return ['user'];
  }

}
