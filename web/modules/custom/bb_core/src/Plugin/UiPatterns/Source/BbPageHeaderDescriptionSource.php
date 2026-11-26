<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\PropTypeInterface;
use Drupal\bb_core\Statistics\InsightsPage;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * The recessive line under the shell page title, when this route has one.
 *
 * A ticket names project / workflow / people. Every other page says what it
 * shows through its route default `_description`; the project page names key
 * and group and Insights its active scope. Any other route leaves it empty.
 * A ticket also fills the `subline` slot, where the creator's age is a time
 * element; the `description` string stays its plain text, shown on hover.
 */
#[Source(
  id: 'bb_page_header_description',
  label: new TranslatableMarkup('[bakers.build] Page header description'),
  description: new TranslatableMarkup('One line of context under the screen title.'),
  prop_types: ['string', 'slot'],
)]
final class BbPageHeaderDescriptionSource extends SourcePluginBase {

  /**
   * Builds the Insights sub-line from the request's filters.
   */
  protected ?InsightsPage $insightsPage = NULL;

  /**
   * The current request, for the Insights filters.
   */
  protected ?RequestStack $requestStack = NULL;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $plugin = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    assert($plugin instanceof self);
    $plugin->insightsPage = $container->get('bb_core.insights_page');
    $plugin->requestStack = $container->get('request_stack');
    return $plugin;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $ticket = $this->ticketForSubline();
    if ($ticket !== NULL) {
      return BbTicketDetailHeaderSource::subline($ticket);
    }
    $description = $this->routeMatch->getRouteObject()?->getDefault('_description');
    if (is_string($description) && $description !== '') {
      // phpcs:ignore Drupal.Semantics.FunctionT.NotLiteralString
      return (string) new TranslatableMarkup($description);
    }
    $route = (string) $this->routeMatch->getRouteName();
    $project = $this->routeMatch->getParameter('bb_project');
    if ($route === 'entity.bb_project.canonical' && $project instanceof BbProjectInterface) {
      return $this->projectSubline($project);
    }
    if ($route === 'bb_core.workspace.insights') {
      return $this->insightsSubline();
    }
    return '';
  }

  /**
   * The ticket whose sub-line this screen shows, or NULL.
   *
   * Nested run URLs carry `{bb_ticket}` too; there the sub-line is the run
   * title's job, not the ticket caption, so a run page shows none and does not
   * expire with the ticket's age.
   */
  private function ticketForSubline(): ?BbTicketInterface {
    if (str_starts_with((string) $this->routeMatch->getRouteName(), 'entity.bb_run.')) {
      return NULL;
    }
    $ticket = $this->routeMatch->getParameter('bb_ticket');
    return $ticket instanceof BbTicketInterface ? $ticket : NULL;
  }

  /**
   * The Insights sub-line: the workspace and what its filters narrow it to.
   */
  private function insightsSubline(): string {
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    $request = $this->requestStack?->getCurrentRequest();
    if (!$workspace instanceof BbWorkspaceInterface || $this->insightsPage === NULL || $request === NULL) {
      return '';
    }
    return $this->insightsPage->scope($workspace, $this->insightsPage->filters($request, $workspace));
  }

  /**
   * Project header caption: identifier prefix and group.
   */
  private function projectSubline(BbProjectInterface $project): string {
    $key = trim((string) $project->get('key')->value);
    $group = $project->get('group_id')->entity;
    $group_label = $group instanceof EntityInterface ? trim((string) $group->label()) : '';
    $parts = [];
    if ($key !== '') {
      $parts[] = 'prefix ' . $key;
    }
    if ($group_label !== '') {
      $parts[] = 'group ' . $group_label;
    }
    return implode(' · ', $parts);
  }

  /**
   * {@inheritdoc}
   *
   * A slot gets a ticket's sub-line with its time element; a string prop gets
   * the plain text, which Twig escapes.
   */
  public function getValue(?PropTypeInterface $prop_type = NULL): mixed {
    if ($prop_type?->getPluginId() !== 'slot') {
      return $this->getPropValue();
    }
    $ticket = $this->ticketForSubline();
    return $ticket === NULL ? [] : BbTicketDetailHeaderSource::sublineElement($ticket);
  }

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $metadata = CacheableMetadata::createFromRenderArray($element)
      ->addCacheContexts(['url.path', 'url.query_args']);
    $ticket = $this->ticketForSubline();
    if ($ticket !== NULL) {
      // The plain-text description carries the creator's age too.
      $metadata = $metadata->merge(TicketStallReason::cacheability($ticket))
        ->merge(CacheableMetadata::createFromRenderArray(BbTicketDetailHeaderSource::sublineElement($ticket)));
    }
    $project = $this->routeMatch->getParameter('bb_project');
    if ($project instanceof BbProjectInterface) {
      $metadata->addCacheableDependency($project);
      $group = $project->get('group_id')->entity;
      if ($group instanceof EntityInterface) {
        $metadata->addCacheableDependency($group);
      }
    }
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if ($workspace instanceof BbWorkspaceInterface) {
      $metadata->addCacheableDependency($workspace);
    }
    $metadata->applyTo($element);
    return $element;
  }

}
