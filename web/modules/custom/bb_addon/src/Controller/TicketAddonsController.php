<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Controller;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Template\Attribute;
use Drupal\bb_addon\AddonOverlayUrls;
use Drupal\bb_addon\AddonRepository;
use Drupal\bb_addon\Island\AddonsIslandHost;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandWrapper;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The ticket's Addons card: a tab per addon, then the selected panel.
 *
 * Always inline in the ticket detail's right column (BB-661) — no overlay,
 * no dialog, no "Addons" wording in the rendered UI. A tab switch re-fetches
 * this same card as a fragment and swaps it whole, so the active tab and the
 * panel update together.
 */
final class TicketAddonsController implements ContainerInjectionInterface {

  /**
   * The DOM id a tab switch selects and swaps.
   */
  public const CARD_ID = 'bakers-addons-card';

  public function __construct(
    private readonly AddonRepository $repository,
    private readonly IslandPluginManagerInterface $islandManager,
    private readonly AddonsIslandHost $host,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_addon.repository'),
      $container->get('plugin.manager.island'),
      $container->get('bb_addon.island_host'),
    );
  }

  /**
   * Renders the card.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $bb_ticket
   *   The ticket.
   * @param string $addon_name
   *   The selected addon; empty for the first.
   *
   * @return array<string, mixed>
   *   The render array, or empty when the ticket's conductor runs no addon.
   */
  public function overlay(BbTicketInterface $bb_ticket, string $addon_name = ''): array {
    $addons = $this->repository->forTicket($bb_ticket);
    if ($addons === []) {
      return ['#cache' => ['max-age' => 0]];
    }
    $current = $addon_name === '' ? array_key_first($addons) : $addon_name;
    if (!isset($addons[$current])) {
      throw new NotFoundHttpException();
    }
    $tabs = $this->tabs($bb_ticket, $addons, $current);
    $island = $this->islandManager->createInstance(AddonsIslandHost::PANEL, [
      'contexts' => ['host' => $this->host, 'placement_id' => AddonsIslandHost::PANEL],
    ]);
    assert($island instanceof IslandInterface);
    $panel = IslandWrapper::wrap(
      $island->getHtmlId(AddonsIslandHost::HOST_ID),
      $island->build(['ticket' => $bb_ticket, 'addon' => $addons[$current]]),
    );
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:surface_card',
      '#props' => [
        'attributes' => new Attribute(['id' => self::CARD_ID, 'data-addons-card' => '']),
      ],
      '#slots' => [
        'header' => count($addons) > 1 ? $tabs : [],
        'content' => $panel,
      ],
      '#attached' => ['library' => ['island/base']],
      '#cache' => ['max-age' => 0],
    ];
  }

  /**
   * The tab strip: one tab per addon, a fragment-swap link to this same card.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $bb_ticket
   *   The ticket.
   * @param array<string, \Drupal\bb_addon\Entity\BbAddonInterface> $addons
   *   The ticket's addons, keyed by name.
   * @param string $current
   *   The selected addon's name.
   *
   * @return array<string, mixed>
   *   The `tabs` component.
   */
  private function tabs(BbTicketInterface $bb_ticket, array $addons, string $current): array {
    $items = [];
    foreach ($addons as $name => $addon) {
      $items[] = [
        '#type' => 'link',
        '#title' => $addon->label(),
        '#url' => AddonOverlayUrls::overlay($bb_ticket, $name),
        '#attributes' => AddonOverlayUrls::cardAttributes($bb_ticket, $name, self::CARD_ID),
        '#attached' => ['library' => ['core/drupal.htmx']],
      ];
    }
    $tabItems = [];
    foreach ($items as $i => $link) {
      $tabItems[] = [
        '#type' => 'component',
        '#component' => 'bb_theme:tab',
        '#props' => ['active' => array_keys($addons)[$i] === $current],
        '#slots' => ['link' => $link],
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:tabs',
      '#slots' => ['tab_items' => $tabItems],
    ];
  }

}
