<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Routing\BbCommentRouteProvider;
use Drupal\bb_core\Time\BbDate;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Compact comment: event plus an accessible canonical link, no sibling nav.
 *
 * The default type `comment` is untagged. Timestamp uses the product `normal`
 * format. Body is the processed markup object so tables stay tables.
 */
#[Source(
  id: 'bb_comment_teaser',
  label: new TranslatableMarkup('[bakers.build] Comment teaser'),
  description: new TranslatableMarkup('Compact comment event and its canonical link.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_comment', label: new TranslatableMarkup('Comment'), required: TRUE),
  ],
)]
final class BbCommentTeaserSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Formats the created stamp in the product `normal` format.
   */
  private BbDate $date;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->date = $container->get(BbDate::class);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $comment = $this->comment();
    if ($comment === NULL || $comment->isNew() || !$comment->access('view')) {
      return [];
    }
    $type = (string) $comment->get('type')->value;
    $props = array_filter([
      'author_name' => (string) $comment->get('author_name')->value,
      'author_initials' => (string) $comment->get('author_initials')->value,
      'author_color' => (string) $comment->get('author_color')->value,
      'tag' => $type !== 'comment' ? $type : '',
      'timestamp' => $this->date->normal($comment->getCreatedTime()),
      'body' => $comment->get('body')->processed,
    ], static fn (mixed $value): bool => $value !== '' && $value !== NULL);
    $links = [
      [
        'url' => $comment->toUrl()->toString(),
        'title' => BbCommentRouteProvider::title($comment),
        'target' => '_self',
      ],
    ];
    $delete = $comment->access('delete', NULL, TRUE);
    if ($delete->isAllowed()) {
      $links[] = [
        'url' => $comment->toUrl('delete-form')->toString(),
        'title' => (string) $this->t('Delete'),
        'target' => '_self',
      ];
    }
    $build = [
      'event' => [
        '#type' => 'component',
        '#component' => 'bb_theme:event',
        '#props' => $props,
      ],
      'canonical' => [
        '#type' => 'component',
        '#component' => 'bb_theme:link-group',
        '#props' => [
          'label' => (string) $this->t('Comment'),
          'links' => $links,
        ],
      ],
    ];
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($comment)
      ->addCacheableDependency($delete)
      ->addCacheContexts(['user'])
      ->applyTo($build);
    return $build;
  }

  /**
   * The comment this display is rendering, or NULL off a comment.
   */
  private function comment(): ?BbCommentInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbCommentInterface ? $entity : NULL;
  }

}
