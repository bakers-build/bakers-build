<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Render;

use Drupal\Core\DependencyInjection\ClassResolverInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\StringTranslation\TranslationInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_addon\AddonReadModel;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_addon\Form\AddonMessageForm;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Renders a contract-2 addon's panel: its MessageForms, then the latest.
 *
 * The requester's own latest answer as Markdown.
 *
 * Extracted from `AddonPanelIsland` (BB-661) to keep that class's
 * complexity bounded; this collaborator carries no state of its own beyond
 * its constructor dependencies and the `$actionLink` callback it is given
 * per call, which supplies the island-specific send-link building
 * (`IslandPluginBase::action()`) without this class depending on the island.
 */
final class AddonMessagePanelRenderer {

  use StringTranslationTrait;

  private const MESSAGE_TONES = [
    'pending' => 'lease',
    'running' => 'running',
    'done' => 'idle',
    'failed' => 'critical',
  ];

  public function __construct(
    private readonly AddonReadModel $readModel,
    private readonly FormBuilderInterface $formBuilder,
    TranslationInterface $stringTranslation,
    private readonly ClassResolverInterface $classResolver,
  ) {
    $this->stringTranslation = $stringTranslation;
  }

  /**
   * Builds the panel.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_addon\Entity\BbAddonInterface $addon
   *   The addon.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The viewer.
   * @param bool $online
   *   Whether the conductor is online.
   * @param \Closure $actionLink
   *   `(string $messageKey, string $label): array` building the send link's
   *   render array (`#url`, `#attributes`, `#attached`), bound to the
   *   calling island.
   * @param array<string, mixed> $formContext
   *   The island/host ids for a message form built through this call.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  public function build(BbTicketInterface $ticket, BbAddonInterface $addon, AccountInterface $account, bool $online, \Closure $actionLink, array $formContext): array {
    $entry = $this->readModel->entry($ticket, $addon, $account);
    $build = [];
    if (!$online) {
      $build['offline'] = $this->notice('warning', (string) $this->t('Conductor offline — messages are queued until it returns'));
    }
    foreach ($entry['messages'] as $message) {
      if ($message['access_ok']) {
        $build['message_' . $message['key']] = $this->messageForm($ticket, $addon, $message, $online, $actionLink, $formContext);
      }
    }
    if ($entry['latest'] === NULL) {
      $build['empty'] = $this->notice('faint', (string) $this->t('You have not sent a message to this addon.'));
      return $build;
    }
    $build['latest'] = $this->latest($entry['latest']);
    return $build;
  }

  /**
   * Whether the panel's latest message is still open (pending or running).
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_addon\Entity\BbAddonInterface $addon
   *   The addon.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The viewer.
   */
  public function isOpen(BbTicketInterface $ticket, BbAddonInterface $addon, AccountInterface $account): bool {
    $entry = $this->readModel->entry($ticket, $addon, $account);
    return in_array($entry['latest']['status'] ?? '', ['pending', 'running'], TRUE);
  }

  /**
   * One contract-2 message's form, or its button when it takes no input.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_addon\Entity\BbAddonInterface $addon
   *   The addon.
   * @param array<string, mixed> $message
   *   The read model's message entry.
   * @param bool $online
   *   Whether the conductor is online.
   * @param \Closure $actionLink
   *   Builds the send link's render array.
   * @param array<string, mixed> $formContext
   *   The island/host ids for the form.
   */
  private function messageForm(BbTicketInterface $ticket, BbAddonInterface $addon, array $message, bool $online, \Closure $actionLink, array $formContext): array {
    if ($message['input'] === NULL || !$online) {
      return $this->sendButton((string) $message['label'], $online, $actionLink, (string) $message['key']);
    }
    $form = $this->classResolver->getInstanceFromDefinition(AddonMessageForm::class);
    assert($form instanceof AddonMessageForm);
    return $this->formBuilder->getForm($form->forMessage($addon->name(), (string) $message['key']), $formContext + [
      'ticket' => $ticket->uuid(),
      'addon' => $addon->name(),
      'message' => $message['key'],
    ]);
  }

  /**
   * A button sending one parameterless contract-2 message.
   */
  private function sendButton(string $label, bool $online, \Closure $actionLink, string $key): array {
    if (!$online) {
      return [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => ['label' => $label, 'type' => 'button', 'disabled' => TRUE, 'variant' => 'neutral'],
      ];
    }
    $link = $actionLink($key, $label);
    $url = $link['#url'];
    assert($url instanceof Url);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#attached' => $link['#attached'] ?? [],
      '#props' => [
        'label' => $label,
        'href' => $url->toString(),
        'variant' => 'neutral',
        'attributes' => new Attribute($link['#attributes'] ?? []),
      ],
    ];
  }

  /**
   * A contract-2 addon's newest message: its status and its Markdown answer.
   *
   * @param array<string, mixed> $latest
   *   The read model's `latest` entry.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function latest(array $latest): array {
    $build = [];
    $build['status'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => [
        'label' => $latest['label'] . ': ' . $latest['status'],
        'tone' => self::MESSAGE_TONES[$latest['status']] ?? 'neutral',
      ],
    ];
    $markdown = $latest['result']['markdown'] ?? NULL;
    if (is_string($markdown) && $markdown !== '') {
      $build['body'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:rich-text',
        '#props' => [
          'body' => check_markup($markdown, 'bb_rich'),
          'label' => (string) $this->t('@label answer', ['@label' => $latest['label']]),
        ],
      ];
    }
    elseif ($markdown === '') {
      $build['body'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:text',
        '#props' => [
          'text' => (string) $this->t('Completed without a response.'),
          'as' => 'p',
          'size' => 'body',
          'tone' => 'faint',
        ],
      ];
    }
    return $build;
  }

  /**
   * A plain text/message notice.
   */
  private function notice(string $tone, string $text): array {
    if ($tone === 'faint') {
      return [
        '#type' => 'component',
        '#component' => 'bb_theme:text',
        '#props' => ['text' => $text, 'as' => 'p', 'size' => 'body', 'tone' => 'faint'],
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:message',
      '#props' => ['status' => $tone],
      '#slots' => ['body' => ['#plain_text' => $text]],
    ];
  }

}
