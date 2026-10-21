<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\ParamConverter\ParamConverterInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Ticket\TicketSearchResolver;
use Drupal\search_api\Plugin\views\filter\SearchApiFulltext;
use Drupal\views\Attribute\ViewsFilter;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The ticket list's one search input, for every form a person types.
 *
 * Extends the contrib fulltext filter: free text behaves exactly as before,
 * and only the lines that are references — an identifier, a bare ticket
 * number, an origin short reference, an origin URL — become exact
 * conditions, which a fulltext query over `title` cannot answer. The grammar
 * lives in the resolver service, which the JSON:API `filter[search]`
 * parameter shares.
 */
#[ViewsFilter('bb_ticket_search')]
class BbTicketSearch extends SearchApiFulltext {

  /**
   * The one place the grammar lives.
   */
  protected TicketSearchResolver $resolver;

  /**
   * Resolves a project argument given as key, uuid or id.
   */
  protected ParamConverterInterface $projectConverter;

  /**
   * Why the typed line could not be resolved, once a pass found out.
   */
  protected ?string $searchError = NULL;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->resolver = $container->get('bb_core.ticket_search_resolver');
    $instance->projectConverter = $container->get('bb_core.paramconverter.project_key');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function validateExposed(&$form, FormStateInterface $form_state): void {
    parent::validateExposed($form, $form_state);
    if (empty($this->options['exposed'])) {
      return;
    }
    $identifier = $this->options['expose']['identifier'];
    $input = $form_state->getValue($identifier, '');
    if (!is_string($input) || trim($input) === '') {
      return;
    }
    $resolved = $this->resolver->resolve($input, $this->projectInContext());
    if ($resolved->failed()) {
      // An empty list would read as "no such ticket": the input is marked
      // invalid, and the empty state says why (searchError()).
      $this->searchError = (string) $resolved->error;
      $form_state->setErrorByName($identifier, $this->searchError);
    }
  }

  /**
   * The resolver's message when the typed line named an unresolvable reference.
   */
  public function searchError(): ?string {
    return $this->searchError;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    $value = $this->value;
    while (is_array($value)) {
      $value = $value ? reset($value) : '';
    }
    $resolved = $this->resolver->resolve((string) $value, $this->projectInContext());
    if ($resolved->isEmpty()) {
      return;
    }
    if ($resolved->failed()) {
      $this->searchError = (string) $resolved->error;
      $this->getQuery()->abort();
      return;
    }
    if ($resolved->field !== NULL) {
      $values = $resolved->value;
      $operator = is_array($values) ? 'IN' : '=';
      // An empty IN cannot be expressed; abort yields an honest empty list.
      if ($values === [] || $values === NULL || $values === '') {
        $this->getQuery()->abort();
        return;
      }
      $this->getQuery()->addCondition($resolved->field, $values, $operator, $this->options['group']);
      return;
    }
    $this->value = $resolved->fulltext;
    parent::query();
  }

  /**
   * The project the display is narrowed to, when its argument names one.
   */
  protected function projectInContext(): ?BbProjectInterface {
    $handler = $this->view->argument['project_id'] ?? NULL;
    if ($handler === NULL) {
      return NULL;
    }
    // Before the arguments are built (exposed validation) only the raw view
    // argument exists; afterwards the validator has replaced it with the id.
    $raw = $handler->argument ?? ($this->view->args[$handler->position] ?? NULL);
    if (!is_scalar($raw) || (string) $raw === '') {
      return NULL;
    }
    $project = $this->projectConverter->convert((string) $raw, ['type' => 'entity:bb_project'], 'bb_project', []);
    return $project instanceof BbProjectInterface && $project->access('view') ? $project : NULL;
  }

}
