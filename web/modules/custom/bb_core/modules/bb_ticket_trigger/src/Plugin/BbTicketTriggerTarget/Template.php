<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\BbTicketTriggerTarget;

use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\TicketTemplate\TemplateNotFoundException;
use Drupal\bb_core\TicketTemplate\TicketTemplateAccessDeniedException;
use Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator;
use Drupal\bb_core\TicketTemplate\TicketTemplateValidationException;
use Drupal\bb_ticket_trigger\Attribute\BbTicketTriggerTarget;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerTargetBase;
use Drupal\bb_ticket_trigger\TicketTrigger\TriggerActionResult;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Creates a ticket from the trigger's template.
 *
 * Creation is TicketTemplateInstantiator's; this target only calls it, and
 * every occurrence gets its own ticket.
 */
#[BbTicketTriggerTarget(
  id: 'template',
  label: new TranslatableMarkup('Template'),
  target_entity_type: 'bb_ticket_template',
  target_field: 'template_id',
)]
final class Template extends TicketTriggerTargetBase {

  /**
   * Failures that retrying cannot fix.
   */
  private const PERMANENT = [
    TemplateNotFoundException::class,
    TicketTemplateAccessDeniedException::class,
    TicketTemplateValidationException::class,
  ];

  /**
   * The shared ticket creation service.
   */
  private TicketTemplateInstantiator $instantiator;

  /**
   * {@inheritdoc}
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The container.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param array<string, mixed> $plugin_definition
   *   The plugin definition.
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->instantiator = $container->get('bb_core.ticket_template_instantiator');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function preflight(BbTicketTriggerInterface $trigger, AccountInterface $actor): ?string {
    $template = $this->getTarget($trigger);
    if (!$template instanceof BbTicketTemplateInterface) {
      return 'The trigger has no template.';
    }
    try {
      $this->instantiator->preflight($template, $actor);
    }
    catch (TemplateNotFoundException | TicketTemplateAccessDeniedException | TicketTemplateValidationException $e) {
      return $e->getMessage();
    }
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function execute(BbTicketTriggerInterface $trigger, AccountInterface $actor): TriggerActionResult {
    $template = $this->getTarget($trigger);
    if (!$template instanceof BbTicketTemplateInterface) {
      throw new TemplateNotFoundException('The trigger has no template.');
    }
    $result = $this->instantiator->instantiate((string) $template->uuid(), $actor);
    $tickets = $this->entityTypeManager->getStorage('bb_ticket')->loadByProperties(['uuid' => $result['ticket_uuid']]);
    $ticket = reset($tickets);
    return new TriggerActionResult(
      sprintf('Created %s.', $result['identifier']),
      $ticket instanceof BbTicketInterface ? $ticket : NULL,
    );
  }

  /**
   * {@inheritdoc}
   */
  public function isPermanentFailure(\Throwable $e): bool {
    return array_filter(self::PERMANENT, static fn (string $class): bool => $e instanceof $class) !== [];
  }

  /**
   * {@inheritdoc}
   */
  public function listUrl(BbTicketTriggerInterface $trigger): ?Url {
    $template = $this->getTarget($trigger);
    return $template === NULL
      ? NULL
      : Url::fromRoute('view.bb_ticket_triggers.template_list', $template->toUrl()->getRouteParameters());
  }

}
