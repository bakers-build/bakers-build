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
 * Listings name the workspace; a ticket names project / workflow / conductor;
 * a project names key and group. Every other screen leaves the sub-line empty.
 */
#[Source(
  id: 'bb_page_header_description',
  label: new TranslatableMarkup('[bakers.build] Page header description'),
  description: new TranslatableMarkup('One line of context under the screen title.'),
  prop_types: ['string'],
)]
final class BbPageHeaderDescriptionSource extends SourcePluginBase {

  /**
   * Builds the Insights sub-line from the request's filters.
   */
  private ?InsightsPage $insightsPage = NULL;

  /**
   * The current request, for the Insights filters.
   */
  private ?RequestStack $requestStack = NULL;

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
    $route = (string) $this->routeMatch->getRouteName();
    // Nested run URLs carry `{bb_ticket}`; the sub-line is the run title's
    // job, not the ticket caption.
    if (str_starts_with($route, 'entity.bb_run.')) {
      return '';
    }
    $ticket = $this->routeMatch->getParameter('bb_ticket');
    if ($ticket instanceof BbTicketInterface) {
      return BbTicketDetailHeaderSource::subline($ticket);
    }
    // Screens that say what they hold; the Billing and Templates tabs
    // instead of the project caption.
    $fixed = [
      'bb_track.account' => $this->t('Who recorded time on this project is billed to'),
      'view.bb_api_keys.page' => $this->t('Keys that let a script, pipeline or other tool act as this account, with exactly its permissions. Dates are UTC.'),
      'view.bb_ticket_templates.project_list' => $this->t('Reusable ticket recipes for this project.'),
      'view.groups.workspace_list' => $this->t('A group grants no permissions — rights come from the workspace and the project only.'),
      'view.bb_service_accounts.settings' => $this->t('Non-human automation accounts bound to this workspace, with their role, team and managed API keys.'),
      'bb_core.my_work.stats' => $this->t('Your own figures — always visible to you'),
      'bb_core.user.profile' => $this->t('bakers.build passes these details as context to the AI assistants it uses, so that explanations and support match your background and your goals. You can change or delete them later.'),
    ];
    if (isset($fixed[$route])) {
      return (string) $fixed[$route];
    }
    $project = $this->routeMatch->getParameter('bb_project');
    if ($project instanceof BbProjectInterface) {
      return $this->projectSubline($project);
    }
    if ($route === 'bb_core.workspace.insights') {
      return $this->insightsSubline();
    }
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    $template = match (TRUE) {
      str_starts_with($route, 'view.tickets.') => 'Every ticket in the @workspace workspace',
      $route === 'view.worklog.page' => 'Your recorded hours in the @workspace workspace',
      $route === 'bb_track.workspace.insights_billing' => '@workspace · billing report',
      $route === 'view.projects.workspace_list' => 'Every project in the @workspace workspace',
      $route === 'view.bb_ticket_templates.workspace_list' => 'Ticket templates for every project in the @workspace workspace',
      default => '',
    };
    if ($template === '') {
      return '';
    }
    if (!$workspace instanceof BbWorkspaceInterface) {
      return str_replace('the @workspace workspace', 'this workspace', $template);
    }
    return str_replace('@workspace', (string) $workspace->label(), $template);
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
   * Project header caption: key and group.
   */
  private function projectSubline(BbProjectInterface $project): string {
    $key = trim((string) $project->get('key')->value);
    $group = $project->get('group_id')->entity;
    $group_label = $group instanceof EntityInterface ? trim((string) $group->label()) : '';
    $parts = [];
    if ($key !== '') {
      $parts[] = 'key ' . $key;
    }
    if ($group_label !== '') {
      $parts[] = 'group ' . $group_label;
    }
    return implode(' · ', $parts);
  }

  /**
   * {@inheritdoc}
   */
  public function getValue(?PropTypeInterface $prop_type = NULL): mixed {
    return $this->getPropValue();
  }

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $metadata = CacheableMetadata::createFromRenderArray($element)
      ->addCacheContexts(['url.path', 'url.query_args']);
    $ticket = $this->routeMatch->getParameter('bb_ticket');
    if ($ticket instanceof BbTicketInterface) {
      $metadata = $metadata->merge(TicketStallReason::cacheability($ticket));
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
