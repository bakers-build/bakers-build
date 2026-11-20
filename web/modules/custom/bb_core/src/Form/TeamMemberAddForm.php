<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Template\Attribute;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Members\MemberFaceOutcome;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\bb_core\Members\MembersDialogResponse;
use Drupal\bb_core\Members\MembershipWriter;
use Drupal\island\Form\WrappedDialogFormBase;
use Drupal\og\Entity\OgMembership;
use Drupal\og\OgMembershipInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The team's add-member dialog: people of the workspace and one role.
 *
 * Opened from the team Members page header. A finished add closes the dialog
 * and the members list re-renders in place, showing the result.
 */
final class TeamMemberAddForm extends WrappedDialogFormBase {

  /**
   * The role the picker opens on: no rank of its own.
   */
  private const string DEFAULT_ROLE = 'member';

  /**
   * Writes the membership and its role.
   */
  protected MembershipWriter $membershipWriter;

  /**
   * Resolves role labels.
   */
  protected MemberItemBuilder $itemBuilder;

  /**
   * The add options and member names.
   */
  protected MemberFaceOutcome $face;

  /**
   * Loads the person a role is checked for.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $translation = $container->get('string_translation');
    $form->membershipWriter = $container->get('bb_core.membership_writer');
    $form->entityTypeManager = $container->get('entity_type.manager');
    $form->itemBuilder = new MemberItemBuilder($container->get('bb_core.date'), $translation, $container->get('module_handler'));
    $form->face = new MemberFaceOutcome($form->membershipWriter, $form->itemBuilder, $container->get('bb_core.workspace_invite'), $translation);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_team_member_add_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $team = $this->team();
    $form['#theme'] = 'bb_create_dialog';
    $form['account'] = [
      '#type' => 'select',
      '#title' => $this->t('People'),
      '#title_display' => 'invisible',
      '#multiple' => TRUE,
      '#options' => $this->face->addOptions($team),
      // Each chosen person shows as a chip; the select stays the value.
      '#theme' => 'select__bb_chip_field',
      // validateForm() refuses a pick outside the options, by name.
      '#validated' => TRUE,
      '#picker_region' => 'lines',
    ];
    $roles = [];
    foreach (MemberItemBuilder::assignableRoles($team) as $name => $role) {
      $roles[$name] = ['label' => $role->getLabel(), 'description' => ''];
    }
    if ($roles !== []) {
      $default = isset($roles[self::DEFAULT_ROLE]) ? self::DEFAULT_ROLE : (string) array_key_first($roles);
      $form['role'] = [
        '#type' => 'bb_picker_value',
        '#title' => $this->t('Role'),
        '#title_display' => 'invisible',
        '#default_value' => [$default],
        '#picker_region' => 'pills',
        '#picker_label' => (string) $this->t('Role'),
        '#picker_icon' => 'user',
        '#picker_options' => $roles,
        '#picker_clear_label' => '',
        '#pre_render' => [[WorkspaceInviteForm::class, 'renderPicker']],
      ];
    }
    $form['actions'] = [
      '#type' => 'actions',
      'cancel' => [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'variant' => 'ghost',
          'label' => (string) $this->t('Cancel'),
          'href' => $this->returnUrl()->toString(),
          'attributes' => new Attribute(['data-dialog-cancel' => 'data-dialog-cancel']),
        ],
        '#weight' => -10,
      ],
      'submit' => [
        '#type' => 'submit',
        '#value' => $this->t('Add member'),
        '#theme_wrappers' => ['input__submit__bb_button'],
      ],
    ];
    $form['#attached']['library'][] = 'core/components.bb_theme--option_picker';
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $team = $this->team();
    $uids = $this->pickedPeople($form_state);
    if ($uids === []) {
      $form_state->setErrorByName('account', $this->t('Choose the people to add.'));
      return;
    }
    $options = $this->face->addOptions($team);
    foreach ($uids as $uid) {
      $refusal = match (TRUE) {
        $this->membershipWriter->membershipOf($team, $uid) !== NULL => $this->t('@name is already a member of this team.', ['@name' => $this->face->memberName($team, $uid)]),
        !isset($options[$uid]) => $this->t('Only people who already belong to this workspace can join the team.'),
        default => NULL,
      };
      if ($refusal !== NULL) {
        $form_state->setErrorByName('account', $refusal);
        return;
      }
    }
    if (!isset($form['role'])) {
      return;
    }
    foreach ($uids as $uid) {
      if (!isset($this->rolesFor($team, $uid)[$this->role($form_state)])) {
        $form_state->setErrorByName('role', $this->t('@name cannot hold that role.', ['@name' => $options[$uid]]));
        return;
      }
    }
  }

  /**
   * The roles this person may hold here, narrowed like their row picker.
   *
   * @return array<string, \Drupal\og\OgRoleInterface>
   *   The roles, keyed by name.
   */
  private function rolesFor(BbTeamInterface $team, int $uid): array {
    $account = $this->entityTypeManager->getStorage('user')->load($uid);
    $roles = MemberItemBuilder::assignableRoles($team);
    if ($account === NULL) {
      return [];
    }
    // Unsaved: it only carries the person and the group to the narrowing hook.
    $candidate = OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($account)
      ->setGroup($team);
    return $this->itemBuilder->rowRoles($candidate, $roles, $team);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $team = $this->team();
    $uids = $this->pickedPeople($form_state);
    $roles = MemberItemBuilder::assignableRoles($team);
    foreach ($uids as $uid) {
      $this->membershipWriter->add($team, $uid);
      if ($roles !== []) {
        $this->membershipWriter->writeRole($team, $uid, $this->role($form_state), $roles);
      }
    }
    $membership = $this->membershipWriter->membershipOf($team, $uids[0]);
    if ($membership !== NULL) {
      $this->messenger()->addMessage($this->formatPlural(count($uids), 'Added @name as @role.', 'Added @count members as @role.', [
        '@name' => $this->face->memberName($team, $uids[0]),
        '@role' => $this->itemBuilder->roleLabel($membership, $team),
      ]), WorkspaceInviteForm::RESULT_MESSAGE_TYPE);
    }
    if (!$this->isDialogRequest()) {
      $form_state->setRedirectUrl($this->returnUrl());
      return;
    }
    $form_state->setResponse(MembersDialogResponse::close());
  }

  /**
   * The picked role name, the default when the picker sent none.
   */
  private function role(FormStateInterface $form_state): string {
    $role = $this->picked($form_state, 'role');
    return $role === '' ? self::DEFAULT_ROLE : $role;
  }

  /**
   * The chosen people's uids, each once, in the order sent.
   *
   * @return list<int>
   *   The uids.
   */
  private function pickedPeople(FormStateInterface $form_state): array {
    $value = $form_state->getValue('account');
    $uids = array_map('intval', array_filter(is_array($value) ? $value : [$value], 'is_scalar'));
    return array_values(array_unique(array_filter($uids)));
  }

  /**
   * One picker's single submitted value, or empty.
   */
  private function picked(FormStateInterface $form_state, string $key): string {
    $value = $form_state->getValue($key);
    $first = is_array($value) ? ($value[0] ?? reset($value)) : $value;
    return is_scalar($first) ? (string) $first : '';
  }

  /**
   * The route's team, which the acting account must be able to update.
   */
  private function team(): BbTeamInterface {
    $team = $this->getRouteMatch()->getParameter('bb_team');
    if (!$team instanceof BbTeamInterface || !$team->access('update', $this->currentUser())) {
      throw new AccessDeniedHttpException();
    }
    return $team;
  }

}
