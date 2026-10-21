<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Canonical run body: the latest ticket summary.
 *
 * Logs stay download-only. This source never reads a run log.
 */
#[Source(
  id: 'bb_run_canonical_body',
  label: new TranslatableMarkup('[bakers.build] Run canonical body'),
  description: new TranslatableMarkup('Latest ticket summary of the run.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_run', label: new TranslatableMarkup('Run'), required: TRUE),
  ],
)]
final class BbRunCanonicalBodySource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Renders the summary comment.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $run = $this->run();
    if ($run === NULL) {
      return [];
    }
    $build = [
      'summary' => $this->zone(
        (string) $this->t('Latest ticket summary'),
        $this->summary($run),
        (string) $this->t('No ticket summary'),
      ),
    ];
    $cache = CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($run)
      ->addCacheContexts(['user'])
      ->addCacheTags(['bb_comment_list', 'bb_ticket_list']);
    $ticket = $run->getTicket();
    if ($ticket !== NULL) {
      $cache->addCacheableDependency($ticket);
    }
    $cache->applyTo($build);
    return $build;
  }

  /**
   * The newest summary comment on the run's ticket, rendered teaser.
   *
   * @return array<string, mixed>
   *   A view builder render array, or empty.
   */
  private function summary(BbRunInterface $run): array {
    $ticket = $run->getTicket();
    if ($ticket === NULL || !$ticket->get('summary_comment')->access('view')) {
      return [];
    }
    $comments = $ticket->get('summary_comment')->referencedEntities();
    $comment = $comments[0] ?? NULL;
    if (!$comment instanceof BbCommentInterface || !$comment->access('view')) {
      return [];
    }
    return $this->entityTypeManager->getViewBuilder('bb_comment')->view($comment, 'teaser');
  }

  /**
   * A zone whose content is the given render array or an empty-state.
   *
   * @param string $heading
   *   The zone heading.
   * @param array<string, mixed> $content
   *   The body, or empty.
   * @param string $empty
   *   Empty-state copy when the body is empty.
   *
   * @return array<string, mixed>
   *   The zone.
   */
  private function zone(string $heading, array $content, string $empty): array {
    if ($content === []) {
      $content = [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => $empty],
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'columns' => 1],
      '#slots' => [
        'heading' => ['#plain_text' => $heading],
        'content' => $content,
      ],
    ];
  }

  /**
   * The run this display is rendering, or NULL off a run.
   */
  private function run(): ?BbRunInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbRunInterface ? $entity : NULL;
  }

}
