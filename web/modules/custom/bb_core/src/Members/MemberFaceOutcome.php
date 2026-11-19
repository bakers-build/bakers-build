<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Form\WorkspaceInviteForm;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\StringTranslation\TranslationInterface;

/**
 * Where a Members action leaves the user, and the parts that decide it.
 *
 * The members form marks its rebuilt face with `data-members-focus` (an
 * element id) and `data-members-announce`; `bb_core/members` applies them.
 * This class names those targets, builds the in-place removal confirmation
 * and the add picker. Like the form, it names no entity type.
 */
final class MemberFaceOutcome implements TrustedCallbackInterface {

  use StringTranslationTrait;

  /**
   * The request key prefix of the confirmation's Remove (or Leave) submit.
   */
  public const string CONFIRM = 'confirm_remove_';

  /**
   * The request key prefix of the confirmation's Cancel submit.
   */
  public const string CANCEL = 'cancel_remove_';

  /**
   * The confirmation's Cancel id, where focus lands when it opens.
   */
  public const string CANCEL_ID = 'members-confirm-cancel';

  /**
   * The add field's id, the focus target when a nested roster empties.
   */
  public const string ADD_ID = 'members-add';

  /**
   * The Invite members trigger's id, the tenancy's fallback target.
   */
  public const string INVITE_ID = WorkspaceInviteForm::TRIGGER_ID;

  public function __construct(
    private readonly MembershipWriter $membershipWriter,
    private readonly MemberItemBuilder $itemBuilder,
    private readonly WorkspaceInvite $tenancyInvite,
    TranslationInterface $string_translation,
  ) {
    $this->setStringTranslation($string_translation);
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['renderAddPicker'];
  }

  /**
   * The outcome attributes the `bb_core/members` behavior applies.
   *
   * @return array<string, string>
   *   The data attributes.
   */
  public static function attributes(string $focus, string $announce = '', string $priority = 'polite'): array {
    return [
      'data-members-focus' => $focus,
      'data-members-announce' => $announce,
      'data-members-announce-priority' => $priority,
    ];
  }

  /**
   * The focus target of a row: its role trigger, or its remove control.
   */
  public function rowFocus(ContentEntityInterface $group, int $uid): string {
    return ($this->itemBuilder->assignableRoles($group) === []
      ? MemberItemBuilder::REMOVE_ID
      : MemberItemBuilder::ROLE_ID) . $uid;
  }

  /**
   * Where focus goes once a row is gone: next row, previous row, else add.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param array<int, int> $uids
   *   The roster's uids before the removal, in roster order.
   * @param int $uid
   *   The removed uid.
   */
  public function afterRemoval(ContentEntityInterface $group, array $uids, int $uid): string {
    $position = array_search($uid, $uids, TRUE);
    $neighbour = $position === FALSE ? NULL : ($uids[$position + 1] ?? $uids[$position - 1] ?? NULL);
    if ($neighbour !== NULL) {
      return $this->rowFocus($group, $neighbour);
    }
    return $this->tenancyInvite->isTenancy($group) ? self::INVITE_ID : self::ADD_ID;
  }

  /**
   * One member's display name, for an announcement.
   */
  public function memberName(ContentEntityInterface $group, int $uid): string {
    $account = $this->membershipWriter->membershipOf($group, $uid)?->getOwner();
    return $account === NULL ? '' : (string) $account->getDisplayName();
  }

  /**
   * The roster's uids, in roster order.
   *
   * @return array<int, int>
   *   The uids.
   */
  public function rosterUids(ContentEntityInterface $group): array {
    return array_values(array_map(
      static fn ($membership): int => (int) $membership->getOwnerId(),
      $this->membershipWriter->memberships($group),
    ));
  }

  /**
   * The in-place confirmation of a removal, or of leaving on the own row.
   *
   * Remove and Cancel are plain submits of the members form, so it works
   * without JavaScript and needs no route of its own.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   * @param int $uid
   *   The member the confirmation is for.
   * @param int $actor
   *   The acting account's uid.
   *
   * @return array<string, mixed>
   *   The open dialog.
   */
  public function confirmation(ContentEntityInterface $group, int $uid, int $actor): array {
    $own = $uid === $actor;
    $name = $this->memberName($group, $uid);
    $button = static fn (string $label, string $variant, array $attributes): array => [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => ['label' => $label, 'variant' => $variant, 'type' => 'submit'],
      '#attributes' => $attributes + ['value' => (string) $uid, 'formnovalidate' => 'formnovalidate'],
    ];
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:dialog',
      '#weight' => 30,
      '#props' => [
        'open' => TRUE,
        'id' => 'members-confirm',
        'title' => $own
          ? (string) $this->t('Leave @group?', ['@group' => $group->label()])
          : (string) $this->t('Remove @name?', ['@name' => $name]),
      ],
      '#attributes' => ['data-members-confirm' => ''],
      '#slots' => [
        'body' => ['#markup' => $this->itemBuilder->removalSentence($group, $name, $own)],
        'actions' => [
          'cancel' => $button((string) $this->t('Cancel'), 'neutral', [
            'name' => self::CANCEL . $uid,
            'id' => self::CANCEL_ID,
            'autofocus' => 'autofocus',
          ]),
          'confirm' => $button($own ? (string) $this->t('Leave') : (string) $this->t('Remove'), 'danger', [
            'name' => self::CONFIRM . $uid,
          ]),
        ],
      ],
    ];
  }

  /**
   * The people a nested group may add: its parent's members not in it yet.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The nested group.
   *
   * @return array<int, string>
   *   Display names keyed by uid, in name order.
   */
  public function addOptions(ContentEntityInterface $group): array {
    $parent = $group->hasField('workspace_id') ? $group->get('workspace_id')->entity : NULL;
    if (!$parent instanceof ContentEntityInterface) {
      return [];
    }
    // shortcut: every candidate renders as an option and the picker filters
    // them in the browser; move to a `search_url` route when a workspace
    // outgrows a few hundred people.
    $in_group = array_flip($this->rosterUids($group));
    $options = [];
    foreach ($this->membershipWriter->memberships($parent) as $membership) {
      $account = $membership->getOwner();
      if ($membership->isActive() && $account !== NULL && !isset($in_group[(int) $account->id()])) {
        $options[(int) $account->id()] = (string) $account->getDisplayName();
      }
    }
    natcasesort($options);
    return $options;
  }

  /**
   * Renders the add field as a searchable picker from its processed value.
   *
   * @param array<string, mixed> $element
   *   The processed picker element.
   *
   * @return array<string, mixed>
   *   The element with its `control` child.
   */
  public static function renderAddPicker(array $element): array {
    $value = (string) (($element['#value'] ?? [])[0] ?? '');
    $rows = [];
    foreach ($element['#picker_options'] as $uid => $label) {
      $rows[] = ['value' => (string) $uid, 'label' => $label, 'selected' => (string) $uid === $value];
    }
    $chosen = $element['#picker_options'][$value] ?? NULL;
    $request = \Drupal::request();
    $element['control'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:property_pill',
      '#props' => [
        'name' => $element['#name'],
        'label' => (string) $element['#title'],
        'icon' => 'user',
        'picker_id' => $element['#id'],
        'multiple' => FALSE,
        'open' => FALSE,
        'searchable' => TRUE,
        // Without JavaScript the panel cannot open; a list stands in. Never in
        // a swapped fragment, where the noscript content would become live.
        'fallback' => !$request->isXmlHttpRequest() && !$request->headers->has('HX-Request'),
        'values' => $chosen === NULL ? [] : [$value],
        'value_label' => $chosen ?? '',
        'options' => $rows,
      ],
    ];
    return $element;
  }

}
