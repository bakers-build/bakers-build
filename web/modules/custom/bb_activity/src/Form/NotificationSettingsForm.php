<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Form;

use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_activity\Entity\NotificationSettingInterface;
use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\bb_activity\NotificationSettings;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The account's activity mail choices at /user/{user}/notifications.
 *
 * One checkbox per kind that offers mail, labelled and described by the kind,
 * built here rather than from a field widget: the row stores plain kind IDs.
 */
final class NotificationSettingsForm extends ContentEntityForm {

  /**
   * The row service.
   */
  private NotificationSettings $settings;

  /**
   * The activity kinds and the mails they offer.
   */
  private ActivityKindManager $kinds;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->settings = $container->get(NotificationSettings::class);
    $form->kinds = $container->get('plugin.manager.bb_activity_kind');
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * The route names the account, not the row. A missing row is offered
   * unsaved with the defaults, so a GET never writes.
   */
  public function getEntityFromRouteMatch(RouteMatchInterface $route_match, $entity_type_id): EntityInterface {
    $user = $route_match->getParameter('user');
    $uid = $user instanceof UserInterface ? (int) $user->id() : 0;
    return $this->settings->forUser($uid) ?? $this->settings->create($uid);
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    // A full-page submit with its own messages, as on the personal schedule.
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['status'] = ['#type' => 'status_messages', '#weight' => -100];
    $row = $this->entity;
    assert($row instanceof NotificationSettingInterface);
    $form['ticks'] = ['#tree' => TRUE] + $this->groups($row->ticked());
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    $actions['submit']['#value'] = $this->t('Save notification settings');
    return $actions;
  }

  /**
   * {@inheritdoc}
   *
   * Stores the ticked IDs of the offers that exist now; a stored ID whose
   * kind is gone is dropped.
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    parent::copyFormValuesToEntity($entity, $form, $form_state);
    assert($entity instanceof NotificationSettingInterface);
    $ticked = [];
    foreach ((array) $form_state->getValue('ticks', []) as $options) {
      foreach ((array) $options as $id => $value) {
        if (is_string($value) && $value !== '' && $value !== '0') {
          $ticked[] = (string) $id;
        }
      }
    }
    $entity->set('messages', array_values(array_intersect(array_keys($this->kinds->mailOffers()), $ticked)));
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $status = parent::save($form, $form_state);
    $row = $this->entity;
    assert($row instanceof NotificationSettingInterface);
    $this->messenger()->addStatus($this->t('Notification settings saved.'));
    $form_state->setRedirect('bb_activity.notifications', ['user' => $row->getOwnerId()]);
    return $status;
  }

  /**
   * The checkboxes element of every mail the kinds offer.
   *
   * @param list<string> $ticked
   *   The stored kind IDs.
   *
   * @return array<string, array<string, mixed>>
   *   The element, keyed `activity_mails`.
   */
  private function groups(array $ticked): array {
    $offers = $this->kinds->mailOffers();
    // Each option's help text sits on the option's own child element.
    $descriptions = array_map(
      static fn (array $offer): array => ['#description' => $offer['description']],
      array_filter($offers, static fn (array $offer): bool => $offer['description'] !== NULL),
    );
    return [
      'activity_mails' => [
        '#type' => 'checkboxes',
        '#title' => $this->t('Activity mails'),
        '#options' => array_map(static fn (array $offer) => $offer['label'], $offers),
        '#default_value' => array_values(array_intersect(array_keys($offers), $ticked)),
      ] + $descriptions,
    ];
  }

}
