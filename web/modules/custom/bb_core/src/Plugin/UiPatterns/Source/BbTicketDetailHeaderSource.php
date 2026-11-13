<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Deployment\DeploymentLookup;
use Drupal\Core\Template\Attribute;
use Drupal\bb_core\Ticket\TicketLinkGroups;
use Drupal\bb_core\Time\BbDate;
use Drupal\state_machine\Plugin\Workflow\WorkflowInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Places the summary band in the canvas header.
 *
 * The ticket headline is the shell page_header island; this source keeps
 * the status band that sits under it.
 */
#[Source(
  id: 'bb_ticket_detail_header',
  label: new TranslatableMarkup('[bakers.build] Ticket detail header'),
  description: new TranslatableMarkup('Ticket workflow state, summary, and links.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', label: new TranslatableMarkup('Ticket'), required: TRUE),
  ],
)]
final class BbTicketDetailHeaderSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Builds the summary comment view.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * Reads the ticket's completed deployment targets.
   */
  protected DeploymentLookup $deploymentLookup;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    $instance->deploymentLookup = $container->get('bb_core.deployment_lookup');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $ticket = $this->ticket();
    return $ticket === NULL ? [] : [$this->band($ticket)];
  }

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $element = parent::alterComponent($element);
    $metadata = CacheableMetadata::createFromRenderArray($element)
      ->addCacheTags(['bb_comment_list', 'bb_run_list', 'bb_ticket_list', 'bb_environment_list', 'og_membership_list'])
      ->addCacheContexts(['user']);
    $ticket = $this->ticket();
    if ($ticket !== NULL) {
      $metadata = $metadata->merge(TicketStallReason::cacheability($ticket));
    }
    $metadata->applyTo($element);
    return $element;
  }

  /**
   * The recessive line under the ticket headline, as plain text.
   *
   * The heading itself is the shell page_header island. This is the
   * project / workflow / people sub-line that island still needs, with the
   * creator's age as its label.
   */
  public static function subline(BbTicketInterface $ticket): string {
    return implode(' · ', array_map(
      static fn (string|array $part): string => is_array($part) ? (string) $part['#props']['label'] : $part,
      self::sublineParts($ticket),
    ));
  }

  /**
   * The sub-line as a render array, the creator's age as a time element.
   *
   * @return array<int|string, mixed>
   *   The parts joined by middots; `#cache` carries the age's max-age.
   */
  public static function sublineElement(BbTicketInterface $ticket): array {
    $element = [];
    foreach (self::sublineParts($ticket) as $i => $part) {
      if ($i > 0) {
        $element[] = ['#plain_text' => ' · '];
      }
      if (is_array($part)) {
        // On top too, where the plain-text description reads it.
        $element['#cache'] = $part['#cache'];
      }
      $element[] = is_array($part) ? $part : ['#plain_text' => $part];
    }
    return $element;
  }

  /**
   * The sub-line's parts in order.
   *
   * @return list<string|array<string, mixed>>
   *   Plain-text parts, and the creator's age as a `bb_theme:time` element.
   */
  private static function sublineParts(BbTicketInterface $ticket): array {
    $parts = [];
    $project = $ticket->getProject();
    if ($project !== NULL) {
      $parts[] = (string) $project->label();
    }
    if ($ticket->getWorkflow() !== '') {
      $parts[] = $ticket->getWorkflow();
    }
    $assignee = $ticket->get('assignee_user_id')->entity;
    if ($assignee instanceof AccountInterface) {
      $parts[] = 'assigned to ' . (string) $assignee->getDisplayName();
    }
    $owner = $ticket->get('owner_user_id')->entity;
    if ($owner instanceof AccountInterface) {
      $parts[] = 'created by ' . (string) $owner->getDisplayName();
      $parts[] = \Drupal::service(BbDate::class)->age((int) $ticket->get('created')->value);
    }
    $conductor = $ticket->getConductor();
    if ($conductor !== NULL) {
      $parts[] = 'claimed by ' . (string) $conductor->label();
    }
    // The stall's age is the stall badge's, as a time element with the date.
    $stall = (string) $ticket->get('stall_reason')->value;
    if ($stall !== '') {
      $parts[] = TicketStallReason::label($stall);
    }
    return $parts;
  }

  /**
   * Builds the summary band.
   */
  private function band(BbTicketInterface $ticket): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:summary-band',
      '#slots' => array_filter([
        'flow' => $this->flow($ticket),
        'summary' => $this->summary($ticket),
        'links' => TicketLinkGroups::build($ticket->get('links')->getValue()),
      ]),
    ];
  }

  /**
   * The summary-band flow: stall badge, then the state chain.
   *
   * A ticket with neither renders no flow region. A ticket with only one
   * fills the slot with that component so callers that read `#component`
   * still see a single child.
   *
   * @return array<string, mixed>
   *   A render array, or empty.
   */
  private function flow(BbTicketInterface $ticket): array {
    $stall = $this->stallBadge($ticket);
    $state = $this->stateFlow($ticket);
    $environments = $this->deploymentLookup->deployedEnvironments($ticket);
    if ($environments !== []) {
      $flow = ['stall' => $stall];
      foreach ($environments as $delta => $environment) {
        $flow['deployment_' . $delta] = [
          '#type' => 'component',
          '#component' => 'bb_theme:badge',
          '#props' => ['label' => $environment, 'tone' => 'neutral'],
          '#attributes' => new Attribute(['aria-label' => (string) $this->t('Deployed to @environment', ['@environment' => $environment])]),
        ];
      }
      $flow['state'] = $state;
      return $flow;
    }
    if ($stall === []) {
      return $state;
    }
    if ($state === []) {
      return $stall;
    }
    return [
      'stall' => $stall,
      'state' => $state,
    ];
  }

  /**
   * The stall badge in the summary-band flow, when the ticket is still.
   *
   * @return array<string, mixed>
   *   A badge render array, or empty.
   */
  private function stallBadge(BbTicketInterface $ticket): array {
    $reason = (string) $ticket->get('stall_reason')->value;
    if ($reason === '') {
      return [];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => TicketStallReason::badge($reason, $ticket->getFrozenAt()),
    ];
  }

  /**
   * Builds the workflow state flow when the ticket has one.
   */
  private function stateFlow(BbTicketInterface $ticket): array {
    if ($ticket->get('state')->isEmpty()) {
      return [];
    }
    $workflow = $ticket->getState()->getWorkflow();
    if (!$workflow instanceof WorkflowInterface) {
      return [];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:state-flow',
      '#props' => [
        'states' => array_keys($workflow->getStates()),
        'current' => (string) $ticket->getState()->getId(),
        'label' => (string) $this->t('Workflow'),
      ],
    ];
  }

  /**
   * Builds the newest summary comment when the ticket has one.
   */
  private function summary(BbTicketInterface $ticket): array {
    $comments = $ticket->get('summary_comment')->referencedEntities();
    $comment = reset($comments);
    return $comment === FALSE ? [] : $this->entityTypeManager
      ->getViewBuilder('bb_comment')
      ->view($comment, 'teaser');
  }

  /**
   * Returns the ticket headline shared by page and document titles.
   */
  public static function headline(BbTicketInterface $ticket): string {
    return $ticket->getIdentifier() === ''
      ? $ticket->getTitle()
      : $ticket->getIdentifier() . ' · ' . $ticket->getTitle();
  }

  /**
   * Returns the ticket context, if present.
   */
  private function ticket(): ?BbTicketInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbTicketInterface ? $entity : NULL;
  }

}
