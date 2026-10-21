<?php

declare(strict_types=1);

namespace Drupal\island\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\island\IslandHostResolver;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandResponder;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Base class for island forms (D3 Form primitive).
 *
 * The island instance is wired from the form build info args
 * (['island_id' => ..., 'host_id' => ...]) which IslandPluginBase::getForm()
 * supplies. A successful submit returns an IslandResponse, converted to the
 * partial HTMX response via FormState::setResponse() — no redirect. The
 * wiring itself lives in IslandFormTrait so any form base class (e.g.
 * ContentEntityForm) can reuse it.
 */
abstract class IslandFormBase extends FormBase {

  use IslandFormTrait;

  public function __construct(
    IslandResponder $responder,
    IslandHostResolver $hostResolver,
    IslandPluginManagerInterface $islandManager,
  ) {
    $this->responder = $responder;
    $this->hostResolver = $hostResolver;
    $this->islandManager = $islandManager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('island.responder'),
      $container->get('island.host_resolver'),
      $container->get('plugin.manager.island'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    // One form class per island form; derive a stable id from the class name.
    return 'island_' . strtolower((string) preg_replace('/(?<!^)[A-Z]/', '_$0', (new \ReflectionClass($this))->getShortName()));
  }

  /**
   * {@inheritdoc}
   */
  final public function buildForm(array $form, FormStateInterface $form_state): array {
    [$island] = $this->resolveIsland($form_state);
    $this->attachIslandHtmx($form, $form_state);
    return $this->buildIslandForm($form, $form_state, $island);
  }

  /**
   * {@inheritdoc}
   */
  final public function validateForm(array &$form, FormStateInterface $form_state): void {
    [$island] = $this->resolveIsland($form_state);
    $this->validateIslandForm($form, $form_state, $island);
  }

  /**
   * {@inheritdoc}
   */
  final public function submitForm(array &$form, FormStateInterface $form_state): void {
    [$island] = $this->resolveIsland($form_state);
    $this->respondIsland($form_state, $this->submitIslandForm($form, $form_state, $island));
  }

  /**
   * Builds the island form elements.
   */
  abstract protected function buildIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): array;

  /**
   * Handles the valid island form submit as an island response.
   */
  abstract protected function submitIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): IslandResponse;

  /**
   * Validates the island form.
   *
   * `$form` is by reference: a form with errors is not rebuilt, so a
   * refusal shown in the same response must be written into `$form` here.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  protected function validateIslandForm(array &$form, FormStateInterface $form_state, IslandInterface $island): void {}

}
