<?php

declare(strict_types=1);

namespace Drupal\island_example\Form;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityTypeBundleInfoInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\island\Form\IslandFormTrait;
use Drupal\island\IslandHostResolver;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandResponder;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Demo entity form wired as an island via IslandFormTrait.
 */
final class NoteForm extends ContentEntityForm {

  use IslandFormTrait;

  public function __construct(
    EntityRepositoryInterface $entity_repository,
    EntityTypeBundleInfoInterface $entity_type_bundle_info,
    TimeInterface $time,
    IslandResponder $responder,
    IslandHostResolver $hostResolver,
    IslandPluginManagerInterface $islandManager,
  ) {
    parent::__construct($entity_repository, $entity_type_bundle_info, $time);
    $this->responder = $responder;
    $this->hostResolver = $hostResolver;
    $this->islandManager = $islandManager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity.repository'),
      $container->get('entity_type.bundle.info'),
      $container->get('datetime.time'),
      $container->get('island.responder'),
      $container->get('island.host_resolver'),
      $container->get('plugin.manager.island'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    // Server-side validation only: an HTML5 "required" attribute would let
    // the browser block the submit natively and the island flow would never
    // run. Required stays enforced by the entity's NotNull constraint.
    $form['title']['widget'][0]['value']['#required'] = FALSE;
    $this->attachIslandHtmx($form, $form_state);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $status = parent::save($form, $form_state);
    $this->respondIsland($form_state, IslandResponse::make()
      ->rebuildSelf()
      ->dispatch('notes.changed', ['id' => $this->entity->id()]));
    return $status;
  }

}
