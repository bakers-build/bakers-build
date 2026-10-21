<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_addon\AddonActionSender;
use Drupal\bb_addon\AddonFormBuilder;
use Drupal\bb_addon\AddonRepository;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\MessageContractValidator;
use Drupal\island\Form\IslandFormBase;
use Drupal\island\IslandInterface;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The generic contract-2 message form, built from the message's input subset.
 *
 * One form per message type, so two message forms never share a form id.
 * The server-side contract validation is the authority; the element types
 * only help the browser. A message with no `input` renders only its submit
 * button.
 */
final class AddonMessageForm extends IslandFormBase {

  /**
   * Resolves the addon.
   */
  private AddonRepository $repository;

  /**
   * Builds the elements and reads the values back.
   */
  private AddonFormBuilder $builder;

  /**
   * Validates the payload.
   */
  private MessageContractValidator $validator;

  /**
   * Sends the message.
   */
  private AddonActionSender $sender;

  /**
   * Loads the ticket.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * The addon and message this instance is for; part of the form id.
   */
  private string $messageKey = '';

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->repository = $container->get('bb_addon.repository');
    $form->builder = $container->get('bb_addon.form_builder');
    $form->validator = $container->get('bb_inbox.message_contract_validator');
    $form->entityTypeManager = $container->get('entity_type.manager');
    $form->sender = $container->get('bb_addon.action_sender');
    return $form;
  }

  /**
   * Binds the instance to one message, so two message forms never share an id.
   */
  public function forMessage(string $addon, string $key): static {
    $this->messageKey = $addon . '_' . $key;
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_addon_message_' . preg_replace('/[^a-z0-9_]/', '_', $this->messageKey);
  }

  /**
   * {@inheritdoc}
   */
  protected function buildIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): array {
    [$ticket, $addon, $key] = $this->target($form_state);
    if ($ticket === NULL) {
      return $form;
    }
    $message = $addon->message($key) ?? [];
    $form += $this->builder->elements($message['input'] ?? []);
    $form['actions'] = [
      '#type' => 'actions',
      'submit' => ['#type' => 'submit', '#value' => $message['label'] ?? $key],
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function validateIslandForm(array &$form, FormStateInterface $form_state, IslandInterface $island): void {
    [$ticket, $addon, $key] = $this->target($form_state);
    if ($ticket === NULL) {
      $form_state->setErrorByName('', (string) $this->t('This message is no longer available.'));
      return;
    }
    $values = $this->builder->values($addon->message($key)['input'] ?? NULL, $form_state->getValues());
    foreach ($this->validator->validateArgs($addon->message($key) ?? [], $values) as $error) {
      [$path] = explode(':', $error, 2);
      $form_state->setErrorByName(isset($form[$path]) ? $path : '', $error);
    }
  }

  /**
   * {@inheritdoc}
   */
  protected function submitIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): IslandResponse {
    [$ticket, $addon, $key] = $this->target($form_state);
    if ($ticket !== NULL) {
      $values = $this->builder->values($addon->message($key)['input'] ?? NULL, $form_state->getValues());
      $this->sender->send($ticket, $addon, $key, $values, $this->currentUser());
    }
    return IslandResponse::make()->rebuildSelf();
  }

  /**
   * The ticket, addon and message key the form was built for.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbTicketInterface|null, 1: \Drupal\bb_addon\Entity\BbAddonInterface|null, 2: string}
   *   The target; NULLs when the ticket or addon is gone.
   */
  private function target(FormStateInterface $form_state): array {
    $args = $form_state->getBuildInfo()['args'][0] ?? [];
    $tickets = $this->entityTypeManager->getStorage('bb_ticket')->loadByProperties(['uuid' => (string) ($args['ticket'] ?? '')]);
    $ticket = reset($tickets);
    if (!$ticket instanceof BbTicketInterface) {
      return [NULL, NULL, ''];
    }
    $addon = $this->repository->forTicket($ticket)[(string) ($args['addon'] ?? '')] ?? NULL;
    $key = (string) ($args['message'] ?? '');
    return $addon instanceof BbAddonInterface && $addon->message($key) !== NULL
      ? [$ticket, $addon, $key]
      : [NULL, NULL, ''];
  }

}
