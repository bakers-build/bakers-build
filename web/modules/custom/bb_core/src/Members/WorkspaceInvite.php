<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Language\LanguageManagerInterface;
use Drupal\Core\Mail\MailManagerInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\StringTranslation\TranslationInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Form\OverlayTrigger;
use Drupal\bb_core\Time\BbDate;
use Drupal\bb_core\Workspace\WorkspaceProvisioner;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;
use Drupal\user\UserInterface;
use Psr\Log\LoggerInterface;

/**
 * The workspace Members add path: an invitation, not a membership write.
 *
 * Nested groups add an existing workspace member. The tenancy itself has no
 * parent, so adding a person is a `bb_invite`, created from the invite
 * dialog (`WorkspaceInviteForm`) and listed and revoked on the Members face.
 */
final class WorkspaceInvite {

  use StringTranslationTrait;

  /**
   * How long an invitation stays redeemable, in days.
   *
   * Computed from `created`, not stored: a second value could disagree with
   * it. An expired invitation is not deleted; it stops being redeemable.
   */
  public const int VALIDITY_DAYS = 7;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    TranslationInterface $stringTranslation,
    private readonly MailManagerInterface $mailManager,
    private readonly TimeInterface $time,
    private readonly LoggerInterface $logger,
    private readonly LanguageManagerInterface $languageManager,
    private readonly AccountProxyInterface $currentUser,
    private readonly BbDate $date,
  ) {
    $this->setStringTranslation($stringTranslation);
  }

  /**
   * Whether an invitation has outlived its validity period.
   *
   * Derived from `created` alone. Revoked invitations are simply deleted (see
   * `revoke()`), so there is no separate revoked state to distinguish here —
   * both the join route and the members list treat "not found" and "expired"
   * the same way, at their own call sites.
   *
   * @param \Drupal\bb_core\Entity\BbInvite $invite
   *   The invitation.
   *
   * @return bool
   *   TRUE when the invitation is older than `VALIDITY_DAYS`.
   */
  public function isExpired(BbInvite $invite): bool {
    $age = $this->time->getRequestTime() - (int) $invite->get('created')->value;
    return $age > self::VALIDITY_DAYS * 86400;
  }

  /**
   * Whether this group is the tenancy itself (no parent workspace).
   */
  public function isTenancy(ContentEntityInterface $group): bool {
    return !$group->hasField('workspace_id') || $group->get('workspace_id')->isEmpty();
  }

  /**
   * The most addresses one submit may invite.
   */
  public const int MAX_ADDRESSES = 50;

  /**
   * The distinct entries of a free-text address list, in order.
   *
   * Lines, commas, semicolons and spaces separate entries; case-insensitive
   * duplicates collapse to their first spelling.
   *
   * @return array<int, string>
   *   The entries, not yet checked for shape.
   */
  public function parseAddresses(mixed $text): array {
    $entries = is_scalar($text) ? preg_split('/[\s,;]+/', (string) $text, -1, PREG_SPLIT_NO_EMPTY) : [];
    $unique = [];
    foreach ($entries ?: [] as $entry) {
      $unique[mb_strtolower($entry)] ??= $entry;
    }
    return array_values($unique);
  }

  /**
   * Sorts a list of addresses into those to invite and those to skip.
   *
   * Nothing is written. A malformed entry or a grant the workspace refuses
   * is an error for the whole submit; an address already invited or already
   * a member is skipped and reported, not refused.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The workspace invited to.
   * @param array<int, string> $addresses
   *   The parsed entries.
   * @param mixed $role
   *   The submitted `og_role` id, or NULL for the member role.
   * @param mixed $team
   *   The submitted team id, or NULL for none.
   *
   * @return array{invite: array<int, string>, skipped: array<string, string>, errors: array<string, string>}
   *   Addresses to invite; skipped addresses with their reason; errors keyed
   *   by `emails`, `workspace_role` or `team_id`.
   */
  public function screen(ContentEntityInterface $group, array $addresses, mixed $role, mixed $team): array {
    $result = ['invite' => [], 'skipped' => [], 'errors' => []];
    $malformed = array_filter($addresses, static fn (string $mail): bool => !filter_var($mail, FILTER_VALIDATE_EMAIL));
    if ($addresses === [] || $malformed !== [] || count($addresses) > self::MAX_ADDRESSES) {
      $result['errors']['emails'] = (string) match (TRUE) {
        $addresses === [] => $this->t('Enter at least one e-mail address.'),
        $malformed !== [] => $this->t('Not an e-mail address: @entries', ['@entries' => implode(', ', $malformed)]),
        default => $this->t('Invite at most @max addresses at once.', ['@max' => self::MAX_ADDRESSES]),
      };
      return $result;
    }
    $candidate = $this->candidate($group, $addresses[0], $role, $team);
    $result['errors'] = $candidate === NULL
      ? ['workspace_role' => (string) $this->t('Choose a workspace role this workspace offers.')]
      : $this->grantViolations($candidate);
    if ($result['errors'] !== []) {
      return $result;
    }
    foreach ($addresses as $mail) {
      $reason = match (TRUE) {
        $this->inviteFor($group, $mail) !== NULL => $this->t('already invited'),
        $this->memberWithMail($group, $mail) !== NULL => $this->t('already a member'),
        default => NULL,
      };
      if ($reason === NULL) {
        $result['invite'][] = $mail;
        continue;
      }
      $result['skipped'][$mail] = (string) $reason;
    }
    if ($result['invite'] === []) {
      $result['errors']['emails'] = (string) $this->t('Everyone listed is already a member or invited.');
    }
    return $result;
  }

  /**
   * Creates a pending invitation for one address, granting a role and team.
   *
   * Validated again here, so no caller saves or mails an invalid grant.
   */
  public function invite(ContentEntityInterface $group, mixed $mail, mixed $role = WorkspaceProvisioner::WORKSPACE_MEMBER_ROLE, mixed $team = NULL): void {
    $address = is_scalar($mail) ? trim((string) $mail) : '';
    if ($address === '') {
      return;
    }
    $invite = $this->candidate($group, $address, $role, $team);
    if ($invite === NULL || $this->grantViolations($invite) !== []) {
      throw new \InvalidArgumentException('The invitation grants a role or team this workspace does not offer.');
    }
    $invite->save();
    $this->sendInviteMail($invite, $group);
  }

  /**
   * The unsaved invitation a submit describes, or NULL for malformed input.
   */
  private function candidate(ContentEntityInterface $group, string $mail, mixed $role, mixed $team): ?BbInvite {
    // Untrusted input: anything but a scalar is refused before any cast.
    if (($role !== NULL && !is_scalar($role)) || ($team !== NULL && !is_scalar($team))) {
      return NULL;
    }
    $role = (string) ($role ?? '');
    $team = (string) ($team ?? '');
    if ($team !== '' && !ctype_digit($team)) {
      return NULL;
    }
    return BbInvite::create([
      'workspace_id' => $group->id(),
      'email' => $mail,
      // An empty pick is the member role, stated explicitly on new rows.
      'workspace_role' => $role !== '' ? $role : WorkspaceProvisioner::WORKSPACE_MEMBER_ROLE,
      'team_id' => $team !== '' ? (int) $team : NULL,
      // SET EXPLICITLY, not left to the field's own default-value callback:
      // this is the one write the mail depends on to name the inviter, and
      // stating it here rather than trusting an indirect default keeps that
      // dependency visible at the call site.
      'owner_user_id' => (int) $this->currentUser->id(),
    ]);
  }

  /**
   * The invitation's role and team violations, one message per field.
   *
   * @return array<string, string>
   *   Messages keyed by `workspace_role` or `team_id`.
   */
  private function grantViolations(BbInvite $invite): array {
    $messages = [];
    foreach ($invite->validate()->getByFields(['workspace_role', 'team_id']) as $violation) {
      $field = str_starts_with($violation->getPropertyPath(), 'team_id') ? 'team_id' : 'workspace_role';
      $messages[$field] ??= (string) $violation->getMessage();
    }
    return $messages;
  }

  /**
   * Mails the invitation, once it is saved.
   *
   * Sent here, not from a save hook, so fixtures and tests that create the
   * entity mail nobody. One body whether or not the address has an account,
   * so the mail leaks no account existence. A send failure is logged and does
   * not roll back the invitation, which is the actual grant.
   */
  private function sendInviteMail(BbInvite $invite, ContentEntityInterface $group): void {
    // READ DIRECTLY FROM THE FIELD, NOT `getOwnerId()`. `BbInvite` declares
    // no `owner` entity key (see its class docblock — deliberate, so the
    // stock owner-widening access handler cannot read it), and
    // `EntityOwnerTrait::getOwnerId()` resolves through THAT key
    // (`$this->getEntityKey('owner')`) rather than through the field's own
    // name — so on this entity it silently returns nothing whatever
    // `owner_user_id` holds.
    $owner_id = (int) $invite->get('owner_user_id')->target_id;
    $inviter = $owner_id > 0 ? $this->entityTypeManager->getStorage('user')->load($owner_id) : NULL;
    $params = [
      'workspace_label' => (string) $group->label(),
      'inviter_label' => $inviter instanceof UserInterface ? (string) $inviter->getDisplayName() : '',
      'validity_days' => self::VALIDITY_DAYS,
      'join_url' => Url::fromRoute('user.login', [], [
        'absolute' => TRUE,
        'query' => ['destination' => Url::fromRoute('bb_core.workspace_join', ['bb_invite' => $invite->id()])->toString()],
      ])->toString(),
    ];
    $result = $this->mailManager->mail(
      'bb_core',
      'invite',
      $invite->getEmail(),
      $this->languageManager->getDefaultLanguage()->getId(),
      $params,
    );
    if ($result['result'] !== TRUE) {
      $this->logger->error('Invitation mail to @mail for workspace @workspace could not be sent.', [
        '@mail' => $invite->getEmail(),
        '@workspace' => $params['workspace_label'],
      ]);
    }
  }

  /**
   * Deletes one pending invitation of this group.
   *
   * The submitted id is untrusted. A matching workspace is the fence: the
   * form already authorised `update` on `$group`, and a sequential id from
   * another workspace must be a no-op.
   */
  public function revoke(ContentEntityInterface $group, int $id): void {
    if ($id <= 0) {
      return;
    }
    $invite = $this->entityTypeManager->getStorage('bb_invite')->load($id);
    if (!$invite instanceof BbInvite) {
      return;
    }
    $workspace = $invite->getWorkspace();
    if ($workspace === NULL || (string) $workspace->id() !== (string) $group->id()) {
      return;
    }
    $invite->delete();
  }

  /**
   * Pending invitations for this workspace.
   *
   * @return array<int, \Drupal\bb_core\Entity\BbInvite>
   *   The invitations, oldest first.
   */
  public function pendingInvites(ContentEntityInterface $group): array {
    $storage = $this->entityTypeManager->getStorage('bb_invite');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('workspace_id', $group->id())
      ->sort('created')
      ->execute();
    return array_values(array_filter(
      $storage->loadMultiple($ids),
      static fn ($invite): bool => $invite instanceof BbInvite,
    ));
  }

  /**
   * List items for pending invitations.
   *
   * @param array<int, \Drupal\bb_core\Entity\BbInvite> $invites
   *   The invitations.
   * @param bool $may_write
   *   Whether the acting account may revoke them.
   *
   * @return array{items: array<int, array<string, mixed>>, controls: array<int, array<string, array<string, mixed>>>}
   *   The same shape MemberItemBuilder::items() returns.
   */
  public function inviteItems(array $invites, bool $may_write): array {
    $items = [];
    $controls = [];
    foreach (array_values($invites) as $index => $invite) {
      $mail = $invite->getEmail();
      $expired = $this->isExpired($invite);
      $cells = [
        'person' => ['kind' => 'text', 'value' => $mail, 'emphasis' => 'strong'],
        'role' => ['kind' => 'badge', 'label' => $this->roleLabel($invite), 'tone' => 'neutral'],
        'team' => ['kind' => 'text', 'value' => $this->teamLabel($invite)],
        'state' => $expired
          ? ['kind' => 'badge', 'label' => (string) $this->t('Expired'), 'tone' => 'critical']
          : ['kind' => 'badge', 'label' => (string) $this->t('Invited'), 'tone' => 'neutral'],
        'joined' => [
          'kind' => 'text',
          'value' => $this->date->date((int) $invite->get('created')->value),
          'emphasis' => 'faint',
        ],
      ];
      if ($may_write) {
        $cells['controls'] = ['kind' => 'rendered'];
        $controls[$index]['remove'] = [
          '#type' => 'component',
          '#component' => 'bb_theme:button',
          // Opens the revoke confirm dialog; a revoke never happens in one
          // click. The href is the confirm page without JavaScript.
          '#attached' => ['library' => ['core/drupal.htmx']],
          '#props' => [
            'variant' => 'ghost',
            'icon_only' => TRUE,
            'label' => $this->t('Revoke invitation for @mail', ['@mail' => $mail]),
            'href' => $invite->toUrl('delete-form')->toString(),
            'attributes' => new Attribute(OverlayTrigger::attributes($invite->toUrl('delete-form'))),
          ],
          '#slots' => [
            'icon' => [
              '#type' => 'component',
              '#component' => 'bb_theme:icon',
              '#props' => ['name' => 'x-circle', 'size' => 'sm'],
            ],
          ],
        ];
      }
      $items[$index] = ['cells' => $cells];
    }
    return ['items' => $items, 'controls' => $controls];
  }

  /**
   * The cache tags the pending list's role and team labels depend on.
   *
   * @return array<int, string>
   *   The tags.
   */
  public function labelCacheTags(): array {
    $fields = BbInvite::baseFieldDefinitions($this->entityTypeManager->getDefinition('bb_invite'));
    $tags = [];
    foreach (['workspace_role', 'team_id'] as $name) {
      $target = (string) $fields[$name]->getSetting('target_type');
      $tags = [...$tags, ...$this->entityTypeManager->getDefinition($target)->getListCacheTags()];
    }
    return $tags;
  }

  /**
   * The granted role's label, resolved now so a renamed role reads current.
   */
  private function roleLabel(BbInvite $invite): string {
    $role = $this->entityTypeManager->getStorage('og_role')->load($invite->getRoleId());
    return $role instanceof OgRoleInterface ? $role->getLabel() : (string) $this->t('Role unavailable');
  }

  /**
   * The granted team's label, or why there is none.
   */
  private function teamLabel(BbInvite $invite): string {
    if ($invite->getTeamId() === NULL) {
      return '-';
    }
    $team = $invite->get('team_id')->entity;
    return $team !== NULL ? (string) $team->label() : (string) $this->t('Team unavailable');
  }

  /**
   * The pending invitation for one address, if any.
   */
  private function inviteFor(ContentEntityInterface $group, string $mail): ?BbInvite {
    foreach ($this->pendingInvites($group) as $invite) {
      if ($invite->isFor($mail)) {
        return $invite;
      }
    }
    return NULL;
  }

  /**
   * A current member whose account mail matches, if any.
   */
  private function memberWithMail(ContentEntityInterface $group, string $mail): ?UserInterface {
    $storage = $this->entityTypeManager->getStorage('og_membership');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', $group->getEntityTypeId())
      ->condition('entity_id', (string) $group->id())
      ->sort('created')
      ->execute();
    foreach ($storage->loadMultiple($ids) as $membership) {
      if (!$membership instanceof OgMembershipInterface) {
        continue;
      }
      $account = $membership->getOwner();
      if ($account instanceof UserInterface && $account->getEmail() !== NULL && mb_strtolower($account->getEmail()) === mb_strtolower($mail)) {
        return $account;
      }
    }
    return NULL;
  }

}
