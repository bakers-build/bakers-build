<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Entity\BbCommentInterface;
use Symfony\Component\Routing\Route;

/**
 * Product canonical for a comment: full view in the workspace shell.
 *
 * Edit, delete, add and the collection stay the routes the parent provides.
 * This provider does not nest the comment under its ticket, does not add
 * parentage checks, and does not add an overlay.
 */
final class BbCommentRouteProvider extends AdminHtmlRouteProvider {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'entity.bb_comment.add_form' => 'Write a new comment.',
    'entity.bb_comment.canonical' => 'This comment on its own page.',
    'entity.bb_comment.edit_form' => 'Change the text of this comment.',
    'entity.bb_comment.delete_form' => 'Confirm the deletion of this comment.',
  ];

  /**
   * {@inheritdoc}
   */
  public function getRoutes(EntityTypeInterface $entity_type) {
    $collection = parent::getRoutes($entity_type);
    foreach (self::DESCRIPTIONS as $name => $description) {
      $collection->get($name)?->setDefault('_description', $description);
    }
    return $collection;
  }

  /**
   * Titles the comment as "Open {type} comment".
   */
  public static function title(BbCommentInterface $bb_comment): string {
    return (string) new TranslatableMarkup('Open @type comment', [
      '@type' => (string) $bb_comment->get('type')->value,
    ]);
  }

  /**
   * {@inheritdoc}
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getCanonicalRoute($entity_type);
    return $route === NULL ? NULL : $this->pinProductView($route);
  }

  /**
   * Pins the full view and product title.
   *
   * The UUID converter and its requirement pattern
   * come from `BbWorkspaceRouteSubscriber::alterRoutes()`, which already
   * applies them to every `/_workspace` route carrying `{bb_comment}`.
   */
  private function pinProductView(Route $route): Route {
    $defaults = $route->getDefaults();
    $defaults['_entity_view'] = 'bb_comment.full';
    unset($defaults['_controller'], $defaults['_title'], $defaults['_title_callback_arguments']);
    $defaults['_title_callback'] = static::class . '::title';
    $route->setDefaults($defaults);
    return $route;
  }

}
