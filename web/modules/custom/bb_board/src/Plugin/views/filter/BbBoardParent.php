<?php

declare(strict_types=1);

namespace Drupal\bb_board\Plugin\views\filter;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\ParamConverter\ParamConverterInterface;
use Drupal\bb_board\ParentTicketScope;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\search_api\Plugin\views\SearchApiHandlerTrait;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\InOperator;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Focuses the Project Board on one parent's visible open descendants.
 *
 * No parent keeps the board's whole project population. A parent narrows
 * every display to its subtree, which {@see ParentTicketScope} resolves.
 * Column membership and the default open work states stay on work_state. A
 * leaf matches nothing and an invalid parent aborts the search, so neither
 * ever widens to the project.
 */
#[ViewsFilter('bb_board_parent')]
final class BbBoardParent extends InOperator {

  use SearchApiHandlerTrait;

  /**
   * {@inheritdoc}
   */
  protected $valueFormType = 'select';

  /**
   * The subtree resolver.
   */
  private ParentTicketScope $scope;

  /**
   * Resolves the board's project from an id or a key.
   */
  private ParamConverterInterface $projectConverter;

  /**
   * The resolved scope of the last query() call, NULL before it.
   *
   * @var array{mode: string, parent: ?\Drupal\bb_core\Entity\BbTicketInterface, ticket_ids: list<string>, message: ?\Drupal\Core\StringTranslation\TranslatableMarkup}|null
   */
  private ?array $resolved = NULL;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = new static($configuration, $plugin_id, $plugin_definition);
    $instance->scope = $container->get(ParentTicketScope::class);
    $instance->projectConverter = $container->get('bb_core.paramconverter.project_key');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getValueOptions(): array {
    $project = $this->project();
    $this->valueOptions = $project === NULL ? [] : $this->scope->options($project);
    return $this->valueOptions;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    $query = $this->getQuery();
    $project = $this->project();
    if ($query === NULL || $project === NULL) {
      return;
    }
    // The raw input, not $this->value: a nested `parent_id[]` must be refused,
    // not flattened into a valid-looking selection.
    $raw = $this->view->getExposedInput()[$this->options['expose']['identifier']] ?? NULL;
    $this->resolved = $this->scope->resolve($project, $raw === 'All' ? NULL : $raw);
    if ($this->resolved['mode'] === 'project') {
      return;
    }
    if ($this->resolved['ticket_ids'] === []) {
      $query->abort();
      return;
    }
    $group = $this->options['group'];
    // The indexed entity id, not `search_api_id`: search_api_db rebuilds each
    // OR facet's query without the search_api_id column, so such a condition
    // makes every facet fail and the pickers go empty. Tagged so the parent_id
    // aggregation still counts every eligible parent while one is focused.
    $tagged = $query->createConditionGroup('AND', ['facet:parent_id']);
    $tagged->addCondition('ticket_id', array_map('intval', $this->resolved['ticket_ids']), 'IN');
    $query->addConditionGroup($tagged, $group);
  }

  /**
   * {@inheritdoc}
   */
  public function buildExposedForm(&$form, FormStateInterface $form_state): void {
    if ($this->getValueOptions() === []) {
      return;
    }
    parent::buildExposedForm($form, $form_state);
  }

  /**
   * The scope this display was queried with, NULL when query() did not run.
   *
   * @return array{mode: string, parent: ?\Drupal\bb_core\Entity\BbTicketInterface, ticket_ids: list<string>, message: ?\Drupal\Core\StringTranslation\TranslatableMarkup}|null
   *   See ParentTicketScope::resolve().
   */
  public function scope(): ?array {
    return $this->resolved;
  }

  /**
   * The board's project, when the reader may view it.
   *
   * The exposed form and the filters are built before the arguments are
   * validated, so the raw argument, an id or the project's key, is resolved
   * the way the argument validator resolves it.
   */
  private function project(): ?BbProjectInterface {
    $reference = $this->view->args[1] ?? NULL;
    if (!is_scalar($reference) || (string) $reference === '') {
      return NULL;
    }
    $project = $this->projectConverter->convert((string) $reference, ['type' => 'entity:bb_project'], 'bb_project', []);
    return $project instanceof BbProjectInterface && $project->access('view') ? $project : NULL;
  }

}
