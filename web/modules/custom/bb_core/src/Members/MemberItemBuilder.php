<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\Component\Render\MarkupInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\StringTranslation\TranslationInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Time\BbDate;
use Drupal\og\Entity\OgRole;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\UserInterface;

/**
 * One membership, as one item of `bb_theme:list`.
 *
 * `GroupMembersForm` owns the writes; this owns the cells. Like the form, it
 * names no entity type (`GroupMemberSurfaceTest`). The role and remove
 * controls are `rendered` cells whose `markup` must be a `MarkupInterface`;
 * they are built here and rendered in the `renderControls()` pre-render, so
 * a POST never renders the roster and Kernel tests need no theme.
 *.
 */
final class MemberItemBuilder implements TrustedCallbackInterface {

  use PersonIdentityTrait;
  use StringTranslationTrait;

  /**
   * The request-key prefix of a per-item remove trigger.
   */
  public const string REMOVE_PREFIX = 'remove_member_';

  /**
   * The request-key prefix of a per-item role trigger.
   */
  public const string ROLE_PREFIX = 'member_role_';

  /**
   * The request-key prefix of a per-item ownership-transfer trigger.
   *
   * Carries the target uid like `REMOVE_PREFIX` and `ROLE_PREFIX`.
   */
  public const string TRANSFER_PREFIX = 'transfer_owner_';

  public function __construct(
    private readonly BbDate $date,
    TranslationInterface $string_translation,
    private readonly ModuleHandlerInterface $moduleHandler,
  ) {
    $this->setStringTranslation($string_translation);
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['renderControls'];
  }

  /**
   * The items of one group's roster, beside the controls they defer.
   *
   * @param array<int, \Drupal\og\OgMembershipInterface> $memberships
   *   The memberships, in the order they should be listed.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group they belong to.
   * @param bool $may_write
   *   Whether the acting account may change this group's crew.
   * @param bool $may_transfer
   *   Whether the acting account currently holds this group's ownership, and
   *   so may hand it to another active member. No default: every caller
   *   states it explicitly.
   *
   * @return array{items: array<int, array<string, mixed>>, controls: array<int, array<string, array<string, mixed>>>}
   *   The items for the component's `items` prop, and the control render
   *   arrays keyed by item index and then by cell key.
   */
  public function items(array $memberships, ContentEntityInterface $group, bool $may_write, bool $may_transfer): array {
    $items = [];
    $controls = [];
    $roles = $this->assignableRoles($group);
    foreach (array_values($memberships) as $index => $membership) {
      // RESOLVED ONCE, HERE, so `cells()` and `controls()` each take one
      // per-row decision instead of the group plus the blanket `$may_transfer`
      // flag — phpmd's `BooleanArgumentFlag` (a defaulted boolean parameter)
      // flagged both of their old signatures, and the two call sites had
      // repeated the identical `$may_transfer && $this->isTransferTarget(...)`
      // condition, which review separately read as a Data Clump.
      $row_roles = $this->rowRoles($membership, $roles, $group);
      // A row whose roles another module narrowed may not receive ownership,
      // which grants every right.
      $show_transfer = $may_transfer && count($row_roles) === count($roles) && $this->isTransferTarget($group, $membership);
      $items[$index] = ['cells' => $this->cells($membership, $row_roles, $may_write, $show_transfer)];
      $controls[$index] = $this->controls($membership, $group, $row_roles, $may_write, $show_transfer);
    }
    return ['items' => $items, 'controls' => $controls];
  }

  /**
   * Whether this membership is a transfer target: an active, non-owning member.
   *
   * GENERIC ON `EntityOwnerInterface`, never on the group's entity type — the
   * same type-blindness this whole file is watched for. A group that carries
   * no owner (does not implement the interface) offers no transfer target at
   * all, which is how a surface that grants nothing says so without branching.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   *
   * @return bool
   *   TRUE when this membership may receive ownership.
   */
  private function isTransferTarget(ContentEntityInterface $group, OgMembershipInterface $membership): bool {
    if (!$group instanceof EntityOwnerInterface) {
      return FALSE;
    }
    if ($membership->getState() !== OgMembershipInterface::STATE_ACTIVE) {
      return FALSE;
    }
    return (int) $membership->getOwnerId() !== (int) $group->getOwnerId();
  }

  /**
   * Renders every deferred cell into the item it belongs to.
   *
   * STATIC, AND THE RENDERER COMES FROM THE CONTAINER. A `#pre_render` callback
   * is serialised with the render array when the element is cached, so a
   * callable bound to an object would drag that object — and everything
   * injected into it — into the cache. A class-and-method pair is the form
   * core's own elements use, for that reason.
   *
   * @param array<string, mixed> $element
   *   The wrapper element holding the list component as its `list` child.
   *
   * @return array<string, mixed>
   *   The element, with every deferred cell carrying its markup.
   */
  public static function renderControls(array $element): array {
    $renderer = \Drupal::service('renderer');
    $deferred = $element['#bb_member_controls'] ?? [];
    foreach ($deferred as $index => $controls) {
      foreach ($controls as $key => $control) {
        if (isset($element['list']['#props']['items'][$index]['cells'][$key])) {
          $element['list']['#props']['items'][$index]['cells'][$key]['markup']
            = $renderer->render($control);
        }
      }
    }
    return $element;
  }

  /**
   * The roles an operator may assign on this group, keyed by submitted value.
   *
   * Read from config, never branched on the group type. The options are the
   * member role (stored as no role: OG adds it on read) plus every standard
   * role; OG's `required` roles are fixtures, not choices. A group type with
   * no standard role yields an empty array, and its items get no role control.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   *
   * @return array<string, \Drupal\og\OgRoleInterface>
   *   The roles, keyed by the value a row submits; empty where none is
   *   assignable.
   */
  public static function assignableRoles(ContentEntityInterface $group): array {
    $standard = [];
    $member = NULL;
    foreach (OgRole::loadByGroupType($group->getEntityTypeId(), $group->bundle()) as $role) {
      if ($role->getRoleType() === OgRoleInterface::ROLE_TYPE_STANDARD) {
        $standard[(string) $role->getName()] = $role;
        continue;
      }
      if ($role->getName() === OgRoleInterface::AUTHENTICATED) {
        $member = $role;
      }
    }
    if ($standard === [] || $member === NULL) {
      return [];
    }
    // The member row FIRST, because it is the state a membership falls back to
    // and the one an operator picks to take a rank away.
    return [(string) $member->getName() => $member] + $standard;
  }

  /**
   * Lets another module narrow one row's role choices, type-blind.
   *
   * `assignableRoles()` returns the group type's FULL vocabulary; this file
   * names no entity type and so cannot itself know that, say, a workspace
   * service account may hold Guest/Contributor but never Lead. The
   * `bb_api_key` module — which depends on `bb_core`, never the other
   * way round — implements `hook_bb_core_member_roles_alter()` to apply
   * that policy for its service-account marker; an ordinary human row
   * reaches no implementation and is returned unchanged.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The group's full assignable-role set.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   *
   * @return array<string, \Drupal\og\OgRoleInterface>
   *   `$roles`, possibly narrowed by an alter implementation.
   */
  public function rowRoles(OgMembershipInterface $membership, array $roles, ContentEntityInterface $group): array {
    $context = ['membership' => $membership, 'group' => $group];
    $this->moduleHandler->alter('bb_core_member_roles', $roles, $context);
    return $roles;
  }

  /**
   * The cells of one item, in the order the membership mapping records.
   *
   * The person, then the role or the state, then the date, then the control.
   * The control is LAST because it acts on the whole item rather than on any
   * one of its values, and a control between two values would read as
   * belonging to one of them.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The assignable roles.
   * @param bool $may_write
   *   Whether the acting account may change this group's crew.
   * @param bool $show_transfer
   *   Whether THIS row is a live transfer target for the acting account —
   *   resolved once by `items()`, so this method takes the per-row decision
   *   rather than the group plus the blanket ownership flag.
   *
   * @return array<string, array<string, mixed>>
   *   The cells, keyed by the name that addresses each value.
   */
  private function cells(OgMembershipInterface $membership, array $roles, bool $may_write, bool $show_transfer): array {
    $cells = ['person' => $this->personCell($membership)];
    $cells += $this->rankCell($membership, $roles, $may_write);
    // The date keeps its WORD, because it is no longer under a column heading
    // that named it. A bare date beside a role would be a fact with no subject.
    $cells['joined'] = [
      'kind' => 'text',
      'value' => $this->t('joined @date', ['@date' => $this->date->date($membership->getCreatedTime())]),
    ];
    if ($show_transfer) {
      $cells['transfer'] = ['kind' => 'rendered'];
    }
    if ($may_write) {
      $cells['remove'] = ['kind' => 'rendered'];
    }
    return $cells;
  }

  /**
   * The one cell that differs between the two arms, as a single-entry map.
   *
   * RETURNED AS A MAP RATHER THAN CHOSEN BY AN `else`, so the caller merges one
   * key without knowing which. The two arms are never both present: an item
   * that carries a role carries no state and the other way round, exactly as
   * the membership mapping produces them.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The assignable roles.
   * @param bool $may_write
   *   Whether the acting account may change this group's crew.
   *
   * @return array<string, array<string, mixed>>
   *   Either a `role` cell or a `state` cell.
   */
  private function rankCell(OgMembershipInterface $membership, array $roles, bool $may_write): array {
    if ($roles === []) {
      // NO ROLE CELL AT ALL where the group type ships nothing to assign — not
      // an empty control and not a disabled one, because a disabled control
      // invites the operator to hunt for what would enable it. What the item
      // carries instead is its membership state, so a blocked or pending
      // membership is not read as an active one.
      return [
        'state' => [
          'kind' => 'badge',
          'label' => $membership->getState(),
          'tone' => 'neutral',
        ],
      ];
    }
    if ($may_write) {
      return ['role' => ['kind' => 'rendered']];
    }
    // A reader who may not write still sees which role the person holds; only
    // the control is withheld.
    return [
      'role' => [
        'kind' => 'badge',
        'label' => $this->currentRoleLabel($membership, $roles),
        'tone' => 'neutral',
      ],
    ];
  }

  /**
   * The person cell, which is the SUBJECT of the item rather than a reference.
   *
   * THE MAIL IS OFFERED, NOT ASSUMED, and the cell derives the two-line
   * identity from its presence. `UserAccessControlHandler` grants `view` on
   * `mail` to the account itself and to `administer users`, so an ordinary
   * member reading a colleague's item is refused and gets the compact identity.
   * That is a real difference between two readers of one screen, and the honest
   * one: the alternative is leaking an address.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   *
   * @return array<string, mixed>
   *   The cell.
   */
  private function personCell(OgMembershipInterface $membership): array {
    $account = $membership->getOwner();
    $name = $this->displayName($membership);
    $cell = [
      'kind' => 'person',
      'display_name' => $name,
      'initials' => $this->personInitials($name),
      'color' => $this->personColor((int) $membership->getOwnerId()),
    ];
    if (!$account instanceof UserInterface) {
      return $cell;
    }
    $mail = (string) ($account->getEmail() ?? '');
    if ($mail !== '' && $account->get('mail')->access('view')) {
      $cell['mail'] = $mail;
    }
    return $cell;
  }

  /**
   * The control render arrays one item defers, keyed by cell.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The assignable roles.
   * @param bool $may_write
   *   Whether the acting account may change this group's crew.
   * @param bool $show_transfer
   *   Whether THIS row is a live transfer target for the acting account —
   *   the same per-row decision `cells()` receives, resolved once by
   *   `items()`. No default: every caller states it explicitly.
   *
   * @return array<string, array<string, mixed>>
   *   The control render arrays.
   */
  private function controls(OgMembershipInterface $membership, ContentEntityInterface $group, array $roles, bool $may_write, bool $show_transfer): array {
    $controls = [];
    $name = $this->displayName($membership);
    if ($show_transfer) {
      $controls['transfer'] = $this->transferControl($membership, $name);
    }
    if (!$may_write) {
      return $controls;
    }
    $controls['remove'] = $this->removeControl($group, $membership, $name);
    if ($roles !== []) {
      $controls['role'] = $this->roleControl($membership, $roles, $name);
    }
    return $controls;
  }

  /**
   * The ownership-transfer control for one membership.
   *
   * Same shape as `removeControl()`: a submit whose name carries the prefix
   * and whose value carries the target uid, so
   * `IslandFormTrait::pressedPrefixed()` resolves it the same way.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param string $name
   *   The person's display name, for the accessible name.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function transferControl(OgMembershipInterface $membership, string $name): array {
    $uid = (int) $membership->getOwnerId();
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'variant' => 'ghost',
        'type' => 'submit',
        'icon_only' => TRUE,
        'label' => $this->t('Make @name the owner of this workspace.', ['@name' => $name]),
      ],
      '#slots' => [
        'icon' => [
          '#type' => 'component',
          '#component' => 'bb_theme:icon',
          // 'crown' does not exist in the theme's icon sprite — the icon
          // component renders an unknown id as an empty string rather than
          // raising, so the control was an invisible ghost button (review
          // verdict 823d8141). 'user' is an id the sprite actually carries.
          '#props' => ['name' => 'user', 'size' => 'sm'],
        ],
      ],
      '#attributes' => [
        'name' => self::TRANSFER_PREFIX . $uid,
        'value' => (string) $uid,
        'formnovalidate' => 'formnovalidate',
      ],
    ];
  }

  /**
   * The role control for one membership.
   *
   * `option_picker` in its `inline` variant, whose contract is that it emits NO
   * hidden inputs "because the pick is the write" — so a value-carrying input
   * is the wrong shape for it and each option row is a named submit trigger
   * instead. That is `option_list`'s `submit_name` mode, and it is what makes
   * the inline contract honest rather than worked around: picking a role and
   * submitting it are one act, and the control still works with JavaScript off
   * because a submit button needs none.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The assignable roles, keyed by the value a row submits.
   * @param string $name
   *   The person's display name, for the accessible name.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function roleControl(OgMembershipInterface $membership, array $roles, string $name): array {
    $current = $this->currentRoleValue($membership, $roles);
    $label = $this->currentRoleLabel($membership, $roles);
    $options = [];
    foreach ($roles as $value => $role) {
      $options[] = [
        'value' => $value,
        'label' => $role->getLabel(),
        'selected' => $value === $current,
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:option_picker',
      '#props' => [
        'variant' => 'inline',
        'label' => $this->t('Role'),
        'name' => 'role',
        'id' => 'member-role-' . $membership->id(),
        'multiple' => FALSE,
        'open' => FALSE,
        'value_labels' => [$label],
        // The accessible name carries BOTH the person and the current value,
        // because the inline variant shows no visible field name and a page of
        // identically-labelled controls is otherwise unusable.
        'aria_label' => $this->t("Change @name's role. Currently @role.", [
          '@name' => $name,
          '@role' => $label,
        ]),
      ],
      '#slots' => [
        'options' => [
          '#type' => 'component',
          '#component' => 'bb_theme:option_list',
          '#props' => [
            'name' => 'role',
            'multiple' => FALSE,
            'submit_name' => self::ROLE_PREFIX . $membership->getOwnerId(),
            'options' => $options,
          ],
        ],
      ],
    ];
  }

  /**
   * The remove control for one membership.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param string $name
   *   The person's display name.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function removeControl(ContentEntityInterface $group, OgMembershipInterface $membership, string $name): array {
    $uid = (int) $membership->getOwnerId();
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'variant' => 'ghost',
        // The one prop that makes this a form control rather than a scripted
        // one. `button` declares the enum and this is the member of it a form
        // needs.
        'type' => 'submit',
        'icon_only' => TRUE,
        // THE EFFECT, NAMED, which is what replaces a confirm step: the rule
        // confirms an action exactly when it ends or discards the ticket, and
        // a membership removal does neither — but it can revoke access, which
        // is a server-side effect. `icon_only` moves this sentence into
        // `aria-label`, so the naming reaches a screen reader and never the
        // visible line.
        'label' => $this->removeSentence($group, $name),
      ],
      '#slots' => [
        'icon' => [
          '#type' => 'component',
          '#component' => 'bb_theme:icon',
          '#props' => ['name' => 'x-circle', 'size' => 'sm'],
        ],
      ],
      // Core merges `#attributes` into `#props['attributes']`, which
      // `button.twig` prints — so the submit pair and the machine handle ride
      // on the component without this class writing any markup of its own.
      '#attributes' => [
        'name' => self::REMOVE_PREFIX . $uid,
        'value' => (string) $uid,
        'formnovalidate' => 'formnovalidate',
        // The documented machine handle the browser suite addresses. Every
        // item's control carries the same label by design, so a caller that
        // has to pick one has only this: the account NAME is not a usable
        // handle, because uid 1 is `admin` on a stock install and
        // `placeholder-for-uid-1` on a `--provider recipe-test` world.
        // Restyling the control must not break a caller; removing this
        // attribute must.
        'data-bakers-member-uid' => (string) $uid,
      ],
    ];
  }

  /**
   * What removing this member does, in the group's own noun.
   *
   * The sentence differs by what the group GRANTS, and that is the reason it
   * cannot live in a template. A group whose roles carry permissions revokes
   * access when a membership ends; one whose roles carry none revokes nothing,
   * and a control claiming otherwise would state the opposite of what the
   * screen says. The distinction is read from the role vocabulary, exactly as
   * the role cell's presence is.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param string $name
   *   The person's display name.
   *
   * @return string
   *   The accessible sentence.
   */
  private function removeSentence(ContentEntityInterface $group, string $name): string {
    $noun = (string) $group->getEntityType()->getSingularLabel();
    if ($this->assignableRoles($group) === []) {
      return (string) $this->t(
        'Remove @name from the @group. A @group membership grants no permissions, so no access is revoked.',
        ['@name' => $name, '@group' => $noun],
      );
    }
    return (string) $this->t('Remove @name from the @group. Revokes their access.', [
      '@name' => $name,
      '@group' => $noun,
    ]);
  }

  /**
   * The value the currently-held role submits.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The assignable roles.
   *
   * @return string
   *   The value of the held role, or of the member role where none is held.
   */
  private function currentRoleValue(OgMembershipInterface $membership, array $roles): string {
    foreach ($membership->getRoles() as $role) {
      $name = (string) $role->getName();
      $standard = $role->getRoleType() === OgRoleInterface::ROLE_TYPE_STANDARD;
      if ($standard && isset($roles[$name])) {
        return $name;
      }
    }
    return OgRoleInterface::AUTHENTICATED;
  }

  /**
   * The label of the currently-held role.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   * @param array<string, \Drupal\og\OgRoleInterface> $roles
   *   The assignable roles.
   *
   * @return string
   *   The label.
   */
  private function currentRoleLabel(OgMembershipInterface $membership, array $roles): string {
    $value = $this->currentRoleValue($membership, $roles);
    return isset($roles[$value]) ? $roles[$value]->getLabel() : $value;
  }

  /**
   * The member's display name, always a string.
   *
   * `getDisplayName()` is typed `MarkupInterface|string`, and both the mark
   * derivation and the accessible sentences need a string — so the narrowing
   * happens once, here, rather than at four call sites.
   *
   * @param \Drupal\og\OgMembershipInterface $membership
   *   The membership.
   *
   * @return string
   *   The display name, or an empty string where the account is gone.
   */
  private function displayName(OgMembershipInterface $membership): string {
    $account = $membership->getOwner();
    if (!$account instanceof UserInterface) {
      return '';
    }
    $name = $account->getDisplayName();
    return $name instanceof MarkupInterface ? (string) $name : (string) $name;
  }

}
