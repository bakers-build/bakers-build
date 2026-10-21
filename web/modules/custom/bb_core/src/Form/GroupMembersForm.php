<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\bb_core\Members\MembershipWriter;
use Drupal\bb_core\Members\OwnershipTransfer;
use Drupal\bb_core\Members\WorkspaceInvite;
use Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionBase;
use Drupal\island\Form\IslandFormBase;
use Drupal\island\IslandHostResolver;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\island\IslandResponder;
use Drupal\island\IslandResponse;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The whole Members face of a group: the roster and the three writes.
 *
 * The group comes from the island host through `GroupMemberFormTrait`, never
 * from the route, and nothing in this file names an entity type
 * (`GroupMemberSurfaceTest` asserts it). The per-item controls are component
 * markup, so the pressed trigger is read from the request, not from
 * `getTriggeringElement()`, and `#required` is not used.
 */
final class GroupMembersForm extends IslandFormBase implements TrustedCallbackInterface {

  use GroupMemberFormTrait;

  /**
   * The request key of the add trigger.
   */
  private const string ADD = 'add_member';

  /**
   * The request key prefix of a pending-invite revoke trigger.
   */
  private const string REVOKE = 'revoke_invite_';

  /**
   * The OG role name the previous owner keeps after a transfer.
   *
   * There is no `owner` OG role, so the previous owner keeps the highest
   * standard role. Looked up by name in `assignableRoles()`, so a group type
   * without it writes nothing.
   */
  private const string PREVIOUS_OWNER_ROLE = 'lead';

  /**
   * {@inheritdoc}
   */
  public function __construct(
    IslandResponder $responder,
    IslandHostResolver $hostResolver,
    IslandPluginManagerInterface $islandManager,
    private readonly MembershipWriter $membershipWriter,
    private readonly MemberItemBuilder $itemBuilder,
    private readonly WorkspaceInvite $tenancyInvite,
    private readonly OwnershipTransfer $ownershipTransfer,
  ) {
    parent::__construct($responder, $hostResolver, $islandManager);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $translation = $container->get('string_translation');
    return new static(
      $container->get('island.responder'),
      $container->get('island.host_resolver'),
      $container->get('plugin.manager.island'),
      $container->get('bb_core.membership_writer'),
      new MemberItemBuilder(
        $container->get('date.formatter'),
        $translation,
        $container->get('module_handler'),
      ),
      $container->get('bb_core.workspace_invite'),
      $container->get('bb_core.ownership_transfer'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['wrapInZone'];
  }

  /**
   * {@inheritdoc}
   */
  protected function buildIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): array {
    $group = $this->group($form_state);
    $access = $this->crewAccess($group);
    // The access result's own cacheability is what keeps a per-account
    // answer out of the next visitor's render cache. Merged rather than
    // hand-listed: `update` on a bakers.build entity resolves through the rank
    // layer, so the contexts and tags it varies on are the result's to
    // declare.
    CacheableMetadata::createFromRenderArray($form)
      ->merge(CacheableMetadata::createFromObject($access))
      ->applyTo($form);
    if ($group === NULL) {
      return $form;
    }

    // THE ROSTER RENDERS FOR EVERY READER OF THE FACE; only the controls are
    // gated. An account that may see the group but not change it gets the
    // list of people and no affordance at all — absent rather than disabled,
    // because a disabled control invites the operator to hunt for what would
    // enable it.
    $may_write = $access->isAllowed();
    $may_transfer = $this->ownershipTransfer->isOwner($group, $this->currentUser());
    $tenancy = $this->tenancyInvite->isTenancy($group);
    // The tenancy invites through its dialog; a nested group adds inline.
    if ($may_write && !$tenancy) {
      $form['invite'] = $this->inviteZone($group);
      $pressed = $this->pressedPrefixed($form_state, [
        MemberItemBuilder::REMOVE_PREFIX,
        MemberItemBuilder::ROLE_PREFIX,
        MemberItemBuilder::TRANSFER_PREFIX,
        self::REVOKE,
      ]);
      if ($pressed !== NULL && isset($form['invite']['account'])) {
        $this->suppressElementValidation($form['invite']['account']);
      }
    }

    if ($tenancy) {
      $form += $this->tenancyParts($group, $may_write);
    }

    $form['roster'] = $this->listZone(
      $this->t('Members'),
      $this->itemBuilder->items($this->membershipWriter->memberships($group), $group, $may_write, $may_transfer),
      $this->t('This @group has no members yet.', ['@group' => $this->groupNoun($group)]),
      20,
    );
    if ($may_write && $tenancy) {
      $form['roster']['#bb_zone_actions'] = WorkspaceInviteForm::trigger($group);
    }

    return $form;
  }

  /**
   * The tenancy's own parts: pending invitations, the confirmation, the button.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The workspace.
   * @param bool $may_write
   *   Whether the acting account may change the crew.
   *
   * @return array<string, mixed>
   *   Elements to merge into the form.
   */
  private function tenancyParts(ContentEntityInterface $group, bool $may_write): array {
    $parts = ['invite_result' => $this->inviteResult()];
    if ($may_write) {
      // The per-item controls are component markup, so with the invite zone
      // gone this face would carry no Form API button, and core treats a POST
      // without one as never submitted: every revoke, role and remove would
      // be dropped silently. One hidden default submit restores that.
      $parts['actions'] = [
        '#type' => 'actions',
        'apply' => [
          '#type' => 'submit',
          '#name' => 'apply',
          '#value' => $this->t('Apply'),
          '#attributes' => ['hidden' => 'hidden', 'formnovalidate' => 'formnovalidate'],
        ],
      ];
    }
    $invites = $this->tenancyInvite->pendingInvites($group);
    if ($invites !== []) {
      $parts['pending'] = $this->listZone(
        $this->t('Pending invitations'),
        $this->tenancyInvite->inviteItems($invites, $may_write, self::REVOKE),
        $this->t('No pending invitations.'),
        15,
      );
      // Role and team labels are resolved at render time.
      $parts['pending']['#cache']['tags'] = $this->tenancyInvite->labelCacheTags();
    }
    return $parts;
  }

  /**
   * Wraps a container's children in a zone at render time.
   *
   * Form API must see `account` as a real child for values and validation.
   * A component `#slots` map is a `#` key, so those children would never
   * be processed. `#pre_render` runs after processing, so the wrap is
   * presentation only.
   */
  public static function wrapInZone(array $element): array {
    $content = [];
    $child_keys = [];
    foreach (array_keys($element) as $key) {
      if (!is_string($key) || $key === '' || $key[0] === '#') {
        continue;
      }
      $child_keys[] = $key;
    }
    foreach ($child_keys as $key) {
      $content[$key] = $element[$key];
      unset($element[$key]);
    }
    $element['zone'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => [
        'inset' => 'none',
        'direction' => $element['#bb_zone_direction'] ?? 'column',
        'description' => (string) ($element['#bb_zone_description'] ?? ''),
      ],
      '#slots' => [
        'heading' => ['#markup' => $element['#bb_zone_heading'] ?? ''],
        'content' => $content,
      ],
    ];
    // Core refuses an empty slot; only a zone with a trigger gets one.
    if (!empty($element['#bb_zone_actions'])) {
      $element['zone']['#slots']['actions'] = $element['#bb_zone_actions'];
    }
    return $element;
  }

  /**
   * The add surface: one person control and one primary submit.
   *
   * IN THE MAIN CONTENT AND NOT A DIALOG, which is a decision with a reason.
   * The dialog rule is written for a create surface with a LIST CONTEXT to
   * lose; this control lives inside the face it changes, and a successful
   * submit re-renders that face alone. A dialog would take the roster away
   * in order to add to it.
   *
   * A nested group (a team) offers only the parent workspace's members.
   * The workspace itself has no parent: adding a person is an invitation.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group this face is rendering.
   *
   * @return array<string, mixed>
   *   The elements, to be merged into the form.
   */
  private function inviteZone(ContentEntityInterface $group): array {
    $account = [
      '#type' => 'entity_autocomplete',
      '#target_type' => 'user',
      '#title' => $this->t('Member'),
      '#placeholder' => $this->t('Search by name'),
      '#required' => FALSE,
      '#weight' => 0,
    ];
    if ($group->hasField('workspace_id') && !$group->get('workspace_id')->isEmpty()) {
      $account['#selection_handler'] = 'bb_workspace_members';
      $account['#selection_settings'] = [
        ActiveWorkspaceSelectionBase::ACTIVE_WORKSPACE_SETTING => (int) $group->get('workspace_id')->target_id,
        'include_anonymous' => FALSE,
      ];
    }
    return $this->inviteZoneFrom(
      $account,
      $this->t('Add member'),
      $this->t('Add a member'),
      $this->t('Only people who already belong to this workspace can join the team.'),
    );
  }

  /**
   * The invite/add zone hull around one person control.
   *
   * @param array<string, mixed> $account
   *   The person field.
   * @param mixed $add_label
   *   Submit label.
   * @param mixed $heading
   *   Zone heading.
   * @param mixed $description
   *   Zone description.
   *
   * @return array<string, mixed>
   *   The zone container.
   */
  private function inviteZoneFrom(array $account, mixed $add_label, mixed $heading, mixed $description): array {
    return [
      '#type' => 'container',
      '#weight' => 0,
      '#pre_render' => [[self::class, 'wrapInZone']],
      '#bb_zone_heading' => $heading,
      '#bb_zone_description' => $description,
      // The zone's fill row lets the field grow and bottom-aligns the submit.
      '#bb_zone_direction' => 'fill',
      'account' => $account,
      'actions' => [
        '#type' => 'actions',
        '#weight' => 10,
        'add' => [
          '#type' => 'submit',
          '#name' => self::ADD,
          '#value' => $add_label,
          '#theme_wrappers' => ['input__submit__bb_button'],
          '#attributes' => ['formnovalidate' => 'formnovalidate'],
        ],
      ],
    ];
  }

  /**
   * A headed list zone: pending invitations or the roster.
   *
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|string $heading
   *   The zone heading.
   * @param array{items: array<int, array<string, mixed>>, controls: array<int, array<string, array<string, mixed>>>} $built
   *   Items and deferred controls.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|string $empty
   *   Empty-state sentence.
   * @param int $weight
   *   Form weight.
   *
   * @return array<string, mixed>
   *   The zone container.
   */
  private function listZone(mixed $heading, array $built, mixed $empty, int $weight): array {
    return [
      '#type' => 'container',
      '#weight' => $weight,
      '#pre_render' => [
        [MemberItemBuilder::class, 'renderControls'],
        [self::class, 'wrapInZone'],
      ],
      '#bb_zone_heading' => $heading,
      '#bb_member_controls' => $built['controls'],
      'list' => [
        '#type' => 'component',
        '#component' => 'bb_theme:list',
        '#props' => [
          'layout' => 'cards',
          'spacing' => 'comfortable',
          // Who and since when on the left; the role and the controls that
          // change the membership right-aligned, as on the projects list.
          'pattern' => [
            'headline' => ['person'],
            'meta' => ['joined', 'team'],
            'right' => ['state', 'role', 'transfer', 'remove'],
          ],
          'items' => $built['items'],
        ],
        '#slots' => [
          'empty' => ['#markup' => $empty],
        ],
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  protected function validateIslandForm(array &$form, FormStateInterface $form_state, IslandInterface $island): void {
    $group = $this->group($form_state);
    // Refused here as well, so the refusal is UNIFORM. Validation runs
    // before the submit handler, so without this a refused account POSTing
    // an already-member uid got a 200 carrying "already a member" instead of
    // a 403 — a different answer for the same lack of authorisation, and one
    // that still spends a query on the caller's behalf.
    if (!$this->crewAccess($group)->isAllowed()) {
      throw new AccessDeniedHttpException();
    }
    if ($group === NULL || $this->tenancyInvite->isTenancy($group) || $this->pressedPrefixed($form_state, [self::ADD]) === NULL) {
      // Only the add carries a field to validate. A removal or a role pick
      // must not be refused because the person control happens to be empty.
      return;
    }
    $uid = $form_state->getValue('account');
    if ($uid === NULL || $uid === '') {
      $form_state->setErrorByName('account', $this->t('Choose the person to add.'));
      return;
    }
    // A second membership for the same account would be accepted by the
    // storage and would render as a duplicate item. Refusing it here is what
    // keeps the list a list of people rather than of memberships. The typed
    // value survives, because `validateIslandForm()` receives the
    // already-built form and a rejected submit is answered with it.
    if ($this->membershipWriter->membershipOf($group, (int) $uid) !== NULL) {
      $form_state->setErrorByName('account', $this->t(
        'That account is already a member of this @group.',
        ['@group' => $this->groupNoun($group)],
      ));
    }
  }

  /**
   * The confirmation the invite dialog left for this face, once.
   *
   * @return array<string, mixed>
   *   A message component, or an uncacheable nothing.
   */
  private function inviteResult(): array {
    $messages = $this->messenger()->messagesByType(WorkspaceInviteForm::RESULT_MESSAGE_TYPE);
    $build = ['#weight' => -5, '#cache' => ['max-age' => 0]];
    if ($messages === []) {
      return $build;
    }
    return $build + [
      '#type' => 'component',
      '#component' => 'bb_theme:message',
      '#props' => ['status' => 'status'],
      '#slots' => ['body' => ['#markup' => implode(' ', array_map('strval', $messages))]],
    ];
  }

  /**
   * {@inheritdoc}
   */
  protected function submitIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): IslandResponse {
    $group = $this->group($form_state);
    // Re-checked, and this is the half that is the gate. The POST is
    // reachable without this form ever having been rendered, so an account
    // that never saw a control can still submit to it — refusing only in the
    // build hides an affordance instead of authorising a write.
    if (!$this->crewAccess($group)->isAllowed() || !$group instanceof ContentEntityInterface) {
      throw new AccessDeniedHttpException();
    }

    // One prefix-scan finds which of the three triggers fired: a browser
    // submits exactly one control, and IslandFormTrait::pressedPrefixed()
    // returns the first of the given prefixes that has a match,
    // paired with the item id the KEY carries.
    $pressed = $this->pressedPrefixed($form_state, [
      self::ADD,
      MemberItemBuilder::REMOVE_PREFIX,
      MemberItemBuilder::ROLE_PREFIX,
      MemberItemBuilder::TRANSFER_PREFIX,
      self::REVOKE,
    ]);
    if ($pressed === NULL) {
      return IslandResponse::make()->rebuildSelf();
    }
    [$prefix, $uid_key] = $pressed;

    if ($prefix === MemberItemBuilder::TRANSFER_PREFIX) {
      return $this->applyTransfer($group, (int) $uid_key);
    }

    if ($prefix === self::ADD) {
      $this->applyAdd($group, $form_state);
      return IslandResponse::make()->rebuildSelf();
    }
    if ($prefix === self::REVOKE) {
      $this->tenancyInvite->revoke($group, (int) $uid_key);
      return IslandResponse::make()->rebuildSelf();
    }
    if ($prefix === MemberItemBuilder::REMOVE_PREFIX) {
      // `(int) $uid_key`, never the tuple itself. Casting the tuple would
      // make PHP fold the array to `1` and remove uid 1 — measured, as
      // three of GroupMemberRemoveTest's cases losing the group owner
      // instead of the pressed member, which is exactly the wrong-member
      // defect that class exists to catch.
      $this->membershipWriter->remove($group, (int) $uid_key);
      return IslandResponse::make()->rebuildSelf();
    }

    // The role VALUE is not part of the key — every option row of one
    // member's picker shares the same `member_role_<uid>` name and differs
    // only in the submitted value, so it is read from the input directly.
    $value = $form_state->getUserInput()[$prefix . $uid_key] ?? '';
    $this->membershipWriter->writeRole(
      $group,
      (int) $uid_key,
      is_scalar($value) ? (string) $value : '',
      $this->rolesFor($group, (int) $uid_key),
    );

    return IslandResponse::make()->rebuildSelf();
  }

  /**
   * One member's assignable roles, with the same narrowing the picker showed.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param int $uid
   *   The member's account id.
   *
   * @return array<string, \Drupal\og\OgRoleInterface>
   *   The roles, keyed by name.
   */
  private function rolesFor(ContentEntityInterface $group, int $uid): array {
    $roles = $this->itemBuilder->assignableRoles($group);
    foreach ($this->membershipWriter->memberships($group) as $membership) {
      if ((int) $membership->getOwnerId() === $uid) {
        return $this->itemBuilder->rowRoles($membership, $roles, $group);
      }
    }
    return $roles;
  }

  /**
   * Adds a nested-group member; the tenancy invites through its dialog.
   */
  private function applyAdd(ContentEntityInterface $group, FormStateInterface $form_state): void {
    // The tenancy has no inline add: it invites through its dialog.
    if ($this->tenancyInvite->isTenancy($group)) {
      throw new AccessDeniedHttpException();
    }
    $this->membershipWriter->add($group, $form_state->getValue('account'));
  }

  /**
   * Applies an ownership-transfer trigger, re-checking who may press it.
   *
   * This is the gate: `crewAccess()` only proves `update`, which a lead also
   * holds, and the POST is reachable without the control ever rendering.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param int $uid
   *   The submitted target account id.
   *
   * @return \Drupal\island\IslandResponse
   *   The rebuild response.
   */
  private function applyTransfer(ContentEntityInterface $group, int $uid): IslandResponse {
    if (!$this->ownershipTransfer->isOwner($group, $this->currentUser())) {
      throw new AccessDeniedHttpException();
    }
    $this->ownershipTransfer->transfer($group, $uid, $this->itemBuilder->assignableRoles($group), self::PREVIOUS_OWNER_ROLE);
    return IslandResponse::make()->rebuildSelf();
  }

  /**
   * Whether the current account may change this group's crew.
   *
   * `update` on the group, not og_membership create access (OG's answer is
   * neutral for everyone but site admins). One gate covers add, remove and
   * role. Returned as a
   * result so the caller carries its cacheability.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface|null $group
   *   The group, or NULL off a group route.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   The access result.
   */
  private function crewAccess(?ContentEntityInterface $group): AccessResultInterface {
    if ($group === NULL) {
      // Off a group route there is nothing to change. Forbidden rather than
      // neutral: this is the same tenancy boundary the island's own build
      // draws, and a neutral result would let another module grant. `route`
      // because that is what the answer depends on — the group comes off the
      // host, which reads the route match.
      return AccessResult::forbidden('The island is not rendering a group.')
        ->addCacheContexts(['route']);
    }
    return $group->access('update', NULL, TRUE);
  }

}
