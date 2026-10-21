<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\area;

use Drupal\bb_core\Plugin\views\filter\BbTicketSearch;
use Drupal\views\Attribute\ViewsArea;
use Drupal\views\Plugin\views\area\TextCustom;

/**
 * Separates an empty context, an unmatched filter and an unreadable search.
 */
#[ViewsArea('bb_contextual_empty')]
final class BbContextualEmpty extends TextCustom {

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function render($empty = FALSE) {
    // UI Patterns renders empty areas without passing the empty flag.
    if ($empty || empty($this->view->result)) {
      // A search the resolver could not read says why, not "no match".
      $error = $this->searchError();
      if ($error !== NULL) {
        return $this->emptyState($error);
      }
      if ($this->hasExposedInput()) {
        return $this->emptyState($this->t('No entries match the selected filters.'));
      }
    }
    $build = parent::render($empty);
    return isset($build['#markup']) ? $this->emptyState($build['#markup']) : $build;
  }

  /**
   * TRUE when any exposed filter carries a chosen value.
   */
  private function hasExposedInput(): bool {
    $input = $this->view->getExposedInput();
    foreach ($this->view->filter as $filter) {
      if (!$filter->isExposed()) {
        continue;
      }
      $identifier = $filter->options['expose']['identifier'] ?? '';
      foreach ((array) ($input[$identifier] ?? []) as $value) {
        if ($value !== '' && $value !== NULL && $value !== 'All') {
          return TRUE;
        }
      }
    }
    return FALSE;
  }

  /**
   * The ticket search's message for a reference it could not resolve.
   */
  private function searchError(): ?string {
    foreach ($this->view->filter as $filter) {
      if ($filter instanceof BbTicketSearch && $filter->searchError() !== NULL) {
        return $filter->searchError();
      }
    }
    return NULL;
  }

  /**
   * Presents the configured message with the shared empty-state component.
   */
  private function emptyState(mixed $message): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:empty-state',
      '#props' => ['message' => (string) $message, 'icon' => 'inbox', 'compact' => TRUE],
    ];
  }

}
