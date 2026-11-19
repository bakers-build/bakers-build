<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Members\MemberFaceOutcome;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\bb_core\Members\MembershipWriter;
use Drupal\bb_core\Members\OwnershipTransfer;
use Drupal\bb_core\Members\WorkspaceInvite;
use Drupal\island\Form\IslandFormBase;
use Drupal\island\IslandHostResolver;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\Core\Url;
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
 *
 * One form owns every write of the face (add, role, remove with its
 * confirmation, transfer, revoke), which is what keeps the island to one
 * POST target; the branching that costs lives in the write helpers.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
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
   * The request attribute carrying a write's outcome to the rebuilt face.
   *
   * `rebuildSelf()` builds a fresh form in the same request, so form state
   * does not reach it; the request does.
   */
  private const string OUTCOME = 'bb_members_outcome';

  /**
   * The request attribute naming the member a confirmation is open for.
   */
  private const string CONFIRMING = 'bb_members_confirming';

  /**
   * {@inheritdoc}
   */
  public function __construct(
    IslandResponder $responder,
    IslandHostResolver $hostResolver,
    IslandPluginManagerInterface $islandManager,
    protected readonly MembershipWriter $membershipWriter,
    protected readonly MemberItemBuilder $itemBuilder,
    protected readonly WorkspaceInvite $tenancyInvite,
    protected readonly OwnershipTransfer $ownershipTransfer,
    protected readonly MemberFaceOutcome $face,
  ) {
    parent::__construct($responder, $hostResolver, $islandManager);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $translation = $container->get('string_translation');
    $writer = $container->get('bb_core.membership_writer');
    $items = new MemberItemBuilder($container->get('bb_core.date'), $translation, $container->get('module_handler'));
    $invite = $container->get('bb_core.workspace_invite');
    return new static(
      $container->get('island.responder'),
      $container->get('island.host_resolver'),
      $container->get('plugin.manager.island'),
      $writer,
      $items,
      $invite,
      $container->get('bb_core.ownership_transfer'),
      new MemberFaceOutcome($writer, $items, $invite, $translation),
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
    $form['#attached']['library'][] = 'bb_core/members';

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
        MemberFaceOutcome::CONFIRM,
        MemberFaceOutcome::CANCEL,
      ]);
      if ($pressed !== NULL && isset($form['invite']['account'])) {
        $this->suppressElementValidation($form['invite']['account']);
      }
    }

    if ($tenancy) {
      $form += $this->tenancyParts($group, $may_write);
    }

    $teams = $tenancy ? $this->membershipWriter->teamNamesByMember($group) : NULL;
    $rows = $this->itemBuilder->items($this->membershipWriter->memberships($group), $group, $may_write, $may_transfer, $teams, (int) $this->currentUser()->id());
    if ($tenancy) {
      // Invitations are rows of the same list, after the members.
      $invites = $this->tenancyInvite->inviteItems($this->tenancyInvite->pendingInvites($group), $may_write);
      $rows = [
        'items' => [...$rows['items'], ...$invites['items']],
        'controls' => $rows['controls'] + self::offsetKeys($invites['controls'], count($rows['items'])),
      ];
    }
    $form['roster'] = $this->listZone(
      $this->t('Members'),
      $rows,
      $this->itemBuilder->columns($tenancy),
      $this->t('@group has no members yet.', ['@group' => $group->label()]),
      20,
    );
    if ($tenancy) {
      // Invitation role and team labels are resolved at render time.
      $form['roster']['#cache']['tags'] = $this->tenancyInvite->labelCacheTags();
    }
    if (!empty($form['invite_trigger'])) {
      $form['roster']['#bb_zone_actions'] = $form['invite_trigger'];
    }
    unset($form['invite_trigger']);
    $this->applyOutcome($form, $group, $may_write);

    return $form;
  }

  /**
   * Marks the face with the last write's outcome and any open confirmation.
   *
   * @param array<string, mixed> $form
   *   The members form.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param bool $may_write
   *   Whether the acting account may change the crew; nothing is marked if not.
   */
  private function applyOutcome(array &$form, ContentEntityInterface $group, bool $may_write): void {
    if (!$may_write) {
      return;
    }
    $attributes = $this->getRequest()->attributes;
    $outcome = $attributes->get(self::OUTCOME);
    // An invite or revoke just finished in its dialog: return to the trigger.
    $result = $form['invite_result']['#bb_result'] ?? '';
    if (!is_array($outcome) && $result !== '') {
      $outcome = MemberFaceOutcome::attributes(MemberFaceOutcome::INVITE_ID, $result);
    }
    if (is_array($outcome)) {
      $form['#attributes'] = $outcome + ($form['#attributes'] ?? []);
    }
    $confirming = $attributes->get(self::CONFIRMING);
    if (is_int($confirming) && $this->membershipWriter->membershipOf($group, $confirming) !== NULL) {
      $form['confirm'] = $this->face->confirmation($group, $confirming, (int) $this->currentUser()->id());
    }
  }

  /**
   * The tenancy's own parts: the invite result, the button, the hidden submit.
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
    $parts = ['invite_result' => $this->inviteResult(), 'invite_trigger' => []];
    if ($may_write) {
      $parts['invite_trigger'] = WorkspaceInviteForm::trigger($group);
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
    return $parts;
  }

  /**
   * Shifts row-indexed controls by the rows that precede them.
   *
   * @param array<int, mixed> $controls
   *   Controls keyed by row index.
   * @param int $offset
   *   The number of rows before them.
   *
   * @return array<int, mixed>
   *   The same controls keyed by their row in the merged list.
   */
  private static function offsetKeys(array $controls, int $offset): array {
    $shifted = [];
    foreach ($controls as $index => $control) {
      $shifted[$index + $offset] = $control;
    }
    return $shifted;
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
        'measure' => 'narrow',
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
      '#type' => 'bb_picker_value',
      '#id' => MemberFaceOutcome::ADD_ID,
      '#title' => $this->t('Member'),
      '#title_display' => 'invisible',
      '#weight' => 0,
      '#picker_options' => $this->face->addOptions($group),
      '#pre_render' => [[MemberFaceOutcome::class, 'renderAddPicker']],
    ];
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
   *   Rows and deferred controls.
   * @param array<int, array{key: string, label: string}> $columns
   *   The table columns.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup|string $empty
   *   Empty-state sentence.
   * @param int $weight
   *   Form weight.
   *
   * @return array<string, mixed>
   *   The zone container.
   */
  private function listZone(mixed $heading, array $built, array $columns, mixed $empty, int $weight): array {
    return [
      '#type' => 'container',
      '#weight' => $weight,
      '#pre_render' => [
        [MemberItemBuilder::class, 'renderControls'],
        [self::class, 'wrapInZone'],
      ],
      '#bb_zone_heading' => $heading,
      '#bb_member_controls' => $built['controls'],
      'list' => $built['items'] === [] ? [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => (string) $empty, 'compact' => TRUE],
      ] : [
        '#type' => 'component',
        '#component' => 'bb_theme:table',
        '#props' => [
          'columns' => $columns,
          'rows' => $built['items'],
          'row_height' => 'lg',
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
    if ($group !== NULL && $this->refuseChange($group, $form_state, $form)) {
      return;
    }
    if ($group === NULL || $this->tenancyInvite->isTenancy($group) || $this->pressedPrefixed($form_state, [self::ADD]) === NULL) {
      // Only the add carries a field to validate. A removal or a role pick
      // must not be refused because the person control happens to be empty.
      return;
    }
    $uid = $this->chosenAccount($form_state);
    if ($uid === 0) {
      $form_state->setErrorByName('account', $this->t('Choose the person to add.'));
      $form['#attributes'] = MemberFaceOutcome::attributes(MemberFaceOutcome::ADD_ID, (string) $this->t('Choose the person to add.'), 'assertive') + ($form['#attributes'] ?? []);
      return;
    }
    // A second membership for the same account would be accepted by the
    // storage and would render as a duplicate item. Refusing it here is what
    // keeps the list a list of people rather than of memberships. The typed
    // value survives, because `validateIslandForm()` receives the
    // already-built form and a rejected submit is answered with it.
    $refusal = match (TRUE) {
      $this->membershipWriter->membershipOf($group, $uid) !== NULL => $this->t(
        'That account is already a member of this @group.',
        ['@group' => $this->groupNoun($group)],
      ),
      !isset($this->face->addOptions($group)[$uid]) => $this->t('Only people who already belong to this workspace can join the team.'),
      default => NULL,
    };
    if ($refusal !== NULL) {
      $form_state->setErrorByName('account', $refusal);
      $form['#attributes'] = MemberFaceOutcome::attributes(MemberFaceOutcome::ADD_ID, (string) $refusal, 'assertive') + ($form['#attributes'] ?? []);
    }
  }

  /**
   * The uid the add picker submitted, or 0.
   */
  private function chosenAccount(FormStateInterface $form_state): int {
    $value = $form_state->getValue('account');
    $first = is_array($value) ? ($value[0] ?? '') : $value;
    return is_scalar($first) ? (int) $first : 0;
  }

  /**
   * Refuses a removal or role pick that leaves the workspace without a head.
   *
   * A refusal also marks the form so focus returns to the refused control and
   * the reason is announced.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param array<string, mixed> $form
   *   The built form, answered back on a refusal.
   *
   * @return bool
   *   TRUE when the pressed change was refused with a form error.
   */
  private function refuseChange(ContentEntityInterface $group, FormStateInterface $form_state, array &$form): bool {
    $change = $this->pressedPrefixed($form_state, [
      MemberItemBuilder::REMOVE_PREFIX,
      MemberFaceOutcome::CONFIRM,
      MemberItemBuilder::ROLE_PREFIX,
    ]);
    if ($change === NULL) {
      return FALSE;
    }
    [$prefix, $uid_key] = $change;
    if ($this->membershipWriter->membershipOf($group, (int) $uid_key) === NULL) {
      // Another manager got there first: say so, and focus where the row was.
      $gone = $this->t('That person is no longer a member of @group.', ['@group' => $group->label()]);
      $form_state->setErrorByName($prefix . $uid_key, $gone);
      $focus = $this->face->afterRemoval($group, $this->face->rosterUids($group), (int) $uid_key);
      $form['#attributes'] = MemberFaceOutcome::attributes($focus, (string) $gone, 'assertive') + ($form['#attributes'] ?? []);
      return TRUE;
    }
    $value = $form_state->getUserInput()[$prefix . $uid_key] ?? '';
    $reason = $this->membershipWriter->refusal(
      $group,
      (int) $uid_key,
      $prefix === MemberItemBuilder::ROLE_PREFIX && is_scalar($value) ? (string) $value : NULL,
    );
    if ($reason !== NULL) {
      $form_state->setErrorByName($prefix . $uid_key, $reason);
      $control = ($prefix === MemberItemBuilder::ROLE_PREFIX ? MemberItemBuilder::ROLE_ID : MemberItemBuilder::REMOVE_ID) . (int) $uid_key;
      $form['#attributes'] = MemberFaceOutcome::attributes($control, (string) $reason, 'assertive') + ($form['#attributes'] ?? []);
    }
    return $reason !== NULL;
  }

  /**
   * Hands an accepted write's outcome to the rebuilt face.
   */
  private function rememberOutcome(string $focus, string $announce): IslandResponse {
    $this->getRequest()->attributes->set(self::OUTCOME, MemberFaceOutcome::attributes($focus, $announce));
    return IslandResponse::make()->rebuildSelf();
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
    // In a zone like the sections, so the message keeps their narrow measure.
    return $build + [
      '#bb_result' => implode(' ', array_map('strval', $messages)),
      '#type' => 'container',
      '#pre_render' => [[self::class, 'wrapInZone']],
      'message' => [
        '#type' => 'component',
        '#component' => 'bb_theme:message',
        '#props' => ['status' => 'status'],
        '#slots' => ['body' => ['#markup' => implode(' ', array_map('strval', $messages))]],
      ],
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
      MemberFaceOutcome::CONFIRM,
      MemberFaceOutcome::CANCEL,
    ]);
    if ($pressed === NULL) {
      return IslandResponse::make()->rebuildSelf();
    }
    [$prefix, $uid_key] = $pressed;
    $uid = (int) $uid_key;

    return match ($prefix) {
      MemberItemBuilder::TRANSFER_PREFIX => $this->applyTransfer($group, $uid),
      self::ADD => $this->applyAdd($group, $this->chosenAccount($form_state)),
      self::REVOKE => $this->applyRevoke($group, $uid),
      // The first press only asks.
      MemberItemBuilder::REMOVE_PREFIX => $this->askToRemove($uid),
      MemberFaceOutcome::CANCEL => $this->rememberOutcome(MemberItemBuilder::REMOVE_ID . $uid, ''),
      MemberFaceOutcome::CONFIRM => $this->applyRemove($group, $uid),
      // The role VALUE is not part of the key: every option row of one
      // member's picker shares `member_role_<uid>` and differs only in the
      // submitted value, so it is read from the input directly.
      default => $this->applyRole($group, $uid, $form_state->getUserInput()[$prefix . $uid_key] ?? ''),
    };
  }

  /**
   * Opens the confirmation for one member in the rebuilt face.
   */
  private function askToRemove(int $uid): IslandResponse {
    $this->getRequest()->attributes->set(self::CONFIRMING, $uid);
    return $this->rememberOutcome(MemberFaceOutcome::CANCEL_ID, '');
  }

  /**
   * Revokes a pending invitation of the tenancy.
   */
  private function applyRevoke(ContentEntityInterface $group, int $id): IslandResponse {
    $this->tenancyInvite->revoke($group, $id);
    return IslandResponse::make()->rebuildSelf();
  }

  /**
   * Writes one member's picked role.
   */
  private function applyRole(ContentEntityInterface $group, int $uid, mixed $value): IslandResponse {
    $this->membershipWriter->writeRole($group, $uid, is_scalar($value) ? (string) $value : '', $this->rolesFor($group, $uid));
    $membership = $this->membershipWriter->membershipOf($group, $uid);
    return $this->rememberOutcome($this->face->rowFocus($group, $uid), $membership === NULL ? '' : (string) $this->t('@name is now @role.', [
      '@name' => $this->face->memberName($group, $uid),
      '@role' => $this->itemBuilder->roleLabel($membership, $group),
    ]));
  }

  /**
   * Removes a confirmed member; leaving the group sends the actor away.
   *
   * `(int)` uid only, never the pressed tuple: casting the tuple folds it to
   * `1` and removes uid 1 (GroupMemberRemoveTest's wrong-member cases).
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param int $uid
   *   The member to remove.
   *
   * @return \Drupal\island\IslandResponse
   *   The rebuild, or the page load after leaving.
   */
  private function applyRemove(ContentEntityInterface $group, int $uid): IslandResponse {
    $name = $this->face->memberName($group, $uid);
    $uids = $this->face->rosterUids($group);
    $this->membershipWriter->remove($group, $uid);
    if ($uid === (int) $this->currentUser()->id()) {
      // The face may no longer be the actor's to see: leave it for a page
      // that surely is.
      $this->messenger()->addStatus($this->t('You left @group.', ['@group' => $group->label()]));
      return IslandResponse::make()->location(
        $this->tenancyInvite->isTenancy($group) ? Url::fromRoute('<front>') : $group->toUrl(),
      );
    }
    return $this->rememberOutcome(
      $this->face->afterRemoval($group, $uids, $uid),
      $name === '' ? '' : (string) $this->t('Removed @name.', ['@name' => $name]),
    );
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
  private function applyAdd(ContentEntityInterface $group, int $uid): IslandResponse {
    // The tenancy has no inline add: it invites through its dialog.
    if ($this->tenancyInvite->isTenancy($group)) {
      throw new AccessDeniedHttpException();
    }
    $this->membershipWriter->add($group, $uid);
    $membership = $this->membershipWriter->membershipOf($group, $uid);
    return $this->rememberOutcome($this->face->rowFocus($group, $uid), $membership === NULL ? '' : (string) $this->t('Added @name as @role.', [
      '@name' => $this->face->memberName($group, $uid),
      '@role' => $this->itemBuilder->roleLabel($membership, $group),
    ]));
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
    return $this->rememberOutcome(
      $this->face->rowFocus($group, $uid),
      (string) $this->t('@name now owns @group.', [
        '@name' => $this->face->memberName($group, $uid),
        '@group' => $group->label(),
      ]),
    );
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
