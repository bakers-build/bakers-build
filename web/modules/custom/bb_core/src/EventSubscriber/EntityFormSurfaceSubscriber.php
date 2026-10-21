<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\bb_core\Form\BbCreateDialogFormBase;
use Drupal\bb_core\Render\EntityFormSurface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ViewEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Frames entity edit forms before HtmlRenderer pre-renders them.
 *
 * Priority 250 is above IslandGetSubscriber (200) and above the HTML main
 * content renderer, so both a boosted fragment and a direct visit wrap the
 * live form. Wrapping after the pre-render left a direct visit as #markup
 * stuffed into a zone, which is why /settings looked different from a rail
 * click. The heading is a sibling shell island, not part of this wrap.
 */
final class EntityFormSurfaceSubscriber implements EventSubscriberInterface {

  /**
   * Form ids that are gate surfaces, not application screens.
   */
  private const GATE_FORM_IDS = [
    'user_login_form',
    'bb_login_form',
    'bb_login_code_form',
    'user_register_form',
    'user_pass',
    'bb_workspace_create_form',
    'bb_workspace_join_form',
  ];

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [KernelEvents::VIEW => [['onView', 250]]];
  }

  /**
   * Wraps a full-page entity form in the canvas surface.
   */
  public function onView(ViewEvent $event): void {
    if (!$event->isMainRequest()) {
      return;
    }
    $request = $event->getRequest();
    if ((string) $request->query->get('_wrapper_format') === 'island_dialog') {
      return;
    }
    $result = $event->getControllerResult();
    if (!is_array($result) || EntityFormSurface::isFramed($result)) {
      return;
    }
    if (($result['#type'] ?? '') !== 'form' && !isset($result['#form_id'])) {
      return;
    }
    $form_id = (string) ($result['#form_id'] ?? '');
    if (in_array($form_id, self::GATE_FORM_IDS, TRUE)) {
      return;
    }
    $form_object = $request->attributes->get('form_object');
    if ($form_object instanceof BbCreateDialogFormBase) {
      return;
    }

    $event->setControllerResult(EntityFormSurface::wrap($result));
  }

}
