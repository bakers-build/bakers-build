<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Plugin\Island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_addon\AddonActionSender;
use Drupal\bb_addon\AddonRepository;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_addon\Render\AddonMessagePanelRenderer;
use Drupal\bb_addon\Island\AddonsIslandHost;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * One addon's panel: its messages and its newest answer.
 *
 * Messages send an inbox message. While a message of this addon is pending
 * or running the panel polls itself.
 */
#[Island(
  id: 'addon_panel',
  label: new TranslatableMarkup('Addon panel'),
  type: 'view',
)]
final class AddonPanelIsland extends IslandPluginBase {

  private const POLL = 'every 3s';

  /**
   * Resolves the addon an action names.
   */
  private AddonRepository $repository;

  /**
   * Sends the actions.
   */
  private AddonActionSender $sender;

  /**
   * The viewer.
   */
  private AccountInterface $currentUser;

  /**
   * Renders a contract-2 addon's panel.
   */
  private AddonMessagePanelRenderer $messagePanelRenderer;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $island = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $island->repository = $container->get('bb_addon.repository');
    $island->sender = $container->get('bb_addon.action_sender');
    $island->currentUser = $container->get('current_user');
    $island->messagePanelRenderer = new AddonMessagePanelRenderer(
      $container->get('bb_addon.read_model'),
      $container->get('form_builder'),
      $container->get('string_translation'),
      $container->get('class_resolver'),
    );
    return $island;
  }

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $ticket = $data['ticket'] ?? NULL;
    $addon = $data['addon'] ?? NULL;
    if (!$ticket instanceof BbTicketInterface || !$addon instanceof BbAddonInterface) {
      return [];
    }
    $build = ['#cache' => ['max-age' => 0]];
    if ($addon->contract() !== 2) {
      $build['contract'] = $this->message('warning', (string) $this->t('Addon contract @n is not supported', ['@n' => $addon->contract()]));
      return $build;
    }
    return $this->buildV2($ticket, $addon, $build);
  }

  /**
   * A contract-2 addon's panel: delegates to `AddonMessagePanelRenderer`.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_addon\Entity\BbAddonInterface $addon
   *   The addon.
   * @param array<string, mixed> $build
   *   The build so far (just `#cache`).
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function buildV2(BbTicketInterface $ticket, BbAddonInterface $addon, array $build): array {
    $online = $ticket->getConductor()?->getStatus() !== 'offline';
    $actionLink = fn (string $key, string $label): array => $this->action('send', [
      'ticket' => $ticket->uuid(),
      'addon' => $addon->name(),
      'action' => $key,
      'args' => '{}',
    ], $label);
    $build += $this->messagePanelRenderer->build($ticket, $addon, $this->currentUser, $online, $actionLink, [
      'island_id' => $this->getRuntimeIslandId(),
      'host_id' => $this->hostId(),
    ]);
    return $this->messagePanelRenderer->isOpen($ticket, $addon, $this->currentUser) ? $this->poll($ticket, $addon, $build) : $build;
  }

  /**
   * {@inheritdoc}
   */
  public function accessAction(string $action, array $parameters, AccountInterface $account): AccessResultInterface {
    $target = $this->target($parameters);
    if ($action !== 'send' || $target === NULL) {
      return AccessResult::forbidden()->setCacheMaxAge(0);
    }
    [$ticket, $addon, $key] = $target;
    $operation = $addon->capability($key)['access'] ?? 'update';
    return AccessResult::allowedIf((bool) $ticket->access($operation, $account))->setCacheMaxAge(0);
  }

  /**
   * {@inheritdoc}
   */
  public function applyAction(string $action, array $parameters): IslandResponse {
    $target = $this->target($parameters);
    $args = json_decode((string) ($parameters['args'] ?? '{}'), TRUE);
    if ($target !== NULL) {
      [$ticket, $addon, $key] = $target;
      $this->sender->send($ticket, $addon, $key, is_array($args) ? $args : [], $this->currentUser);
    }
    return IslandResponse::make()->rebuildSelf();
  }

  /**
   * The ticket, addon and action an action request names.
   *
   * @param array<string, mixed> $parameters
   *   The action parameters.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbTicketInterface, 1: \Drupal\bb_addon\Entity\BbAddonInterface, 2: string}|null
   *   The target, NULL when any part is unknown.
   */
  private function target(array $parameters): ?array {
    $uuid = (string) ($parameters['ticket'] ?? '');
    $tickets = $uuid === '' ? [] : $this->entityTypeManager->getStorage('bb_ticket')->loadByProperties(['uuid' => $uuid]);
    $ticket = reset($tickets);
    if (!$ticket instanceof BbTicketInterface) {
      return NULL;
    }
    $addon = $this->repository->forTicket($ticket)[(string) ($parameters['addon'] ?? '')] ?? NULL;
    $key = (string) ($parameters['action'] ?? '');
    if ($addon === NULL) {
      return NULL;
    }
    return $addon->capability($key) !== NULL ? [$ticket, $addon, $key] : NULL;
  }

  /**
   * Wraps the panel so it re-fetches itself until no message is open.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_addon\Entity\BbAddonInterface $addon
   *   The addon.
   * @param array<string, mixed> $build
   *   The panel.
   *
   * @return array<string, mixed>
   *   The polling container.
   */
  private function poll(BbTicketInterface $ticket, BbAddonInterface $addon, array $build): array {
    $id = '#' . $this->getHtmlId(AddonsIslandHost::HOST_ID);
    $url = Url::fromRoute('bb_addon.overlay', $ticket->toUrl()->getRouteParameters() + ['addon_name' => $addon->name()]);
    $container = ['#type' => 'container', 'panel' => $build, '#cache' => ['max-age' => 0]];
    (new Htmx())->get($url)->onlyMainContent()->trigger(self::POLL)->select($id)->target($id)->swap('outerHTML')
      ->applyTo($container);
    return $container;
  }

  /**
   * A message component.
   */
  private function message(string $status, string $text): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:message',
      '#props' => ['status' => $status],
      '#slots' => ['body' => ['#plain_text' => $text]],
    ];
  }

}
