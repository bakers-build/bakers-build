<?php

declare(strict_types=1);

namespace Drupal\bb_track\Controller;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Render\RendererInterface;
use Drupal\bb_track\WorkTargetOptions;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Server-side search for the time form's ticket picker.
 */
final class WorklogOptionsController implements ContainerInjectionInterface {

  /**
   * Constructs the controller.
   */
  public function __construct(
    private WorkTargetOptions $options,
    private RendererInterface $renderer,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('bb_track.target_options'), $container->get('renderer'));
  }

  /**
   * The matching option rows as an htmx fragment.
   */
  public function ticketFragment(Request $request): Response {
    $build = $this->ticketOptions($request);
    return new Response((string) $this->renderer->renderInIsolation($build), 200, [
      'Content-Type' => 'text/html; charset=UTF-8',
      'Cache-Control' => 'private, no-store',
    ]);
  }

  /**
   * The option list of the project's tickets matching the typed text.
   *
   * @return array<string, mixed>
   *   A bb_theme:option_list render array.
   */
  public function ticketOptions(Request $request): array {
    $match = mb_substr(trim((string) $request->query->get('q', '')), 0, 100);
    $rows = [];
    foreach ($this->options->tickets((int) $request->query->get('project'), $match === '' ? NULL : $match) as $id => $label) {
      $rows[] = ['value' => (string) $id, 'label' => $label];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:option_list',
      '#props' => ['multiple' => FALSE, 'options' => $rows],
    ];
  }

}
