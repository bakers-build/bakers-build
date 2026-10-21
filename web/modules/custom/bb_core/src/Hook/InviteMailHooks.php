<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\StringTranslation\StringTranslationTrait;

/**
 * The workspace invitation mail.
 *
 * ONE BODY, no branch on whether the invited address already holds an
 * account — `WorkspaceInvite` composes the same params either way, so the
 * difference cannot leak into what gets sent. The body names the workspace,
 * the inviter and the validity period, and carries one link that lands on
 * the sign-in gate with the invitation's own confirmation screen parked as
 * the `destination` — the same mechanism `bb_login`'s mailed link and
 * `BbOneTimeLoginController` already carry a deep link through.
 */
final class InviteMailHooks {

  use StringTranslationTrait;

  /**
   * Implements hook_mail().
   *
   * @param string $key
   *   The mail key. Only `invite` is handled here.
   * @param array<string, mixed> $message
   *   The message array to build.
   * @param array<string, mixed> $params
   *   Parameters supplied by WorkspaceInvite::sendInviteMail().
   */
  #[Hook('mail')]
  public function mail(string $key, array &$message, array $params): void {
    if ($key !== 'invite') {
      return;
    }
    $message['subject'] = $this->t('Join @workspace on bakers.build', [
      '@workspace' => $params['workspace_label'],
    ]);
    $inviter_label = $params['inviter_label'] !== ''
      ? $params['inviter_label']
      : $this->t('Somebody');
    $message['body'][] = $this->t("# You're invited");
    $message['body'][] = $this->t('@inviter would love for you to join @workspace. Your team is looking forward to working with you.', [
      '@inviter' => $inviter_label,
      '@workspace' => $params['workspace_label'],
    ]);
    $message['body'][] = $this->t('Accept invitation: @url', [
      '@url' => $params['join_url'],
    ]);
    $message['body'][] = $this->t('The invitation expires in @days days.', [
      '@days' => $params['validity_days'],
    ]);
  }

}
