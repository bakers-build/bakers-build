<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Utility\Html;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Controller\BbHomeController;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Members\InviteAcceptance;
use Drupal\bb_core\Plugin\Field\FieldFormatter\EntityImageTrait;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Members\WorkspaceInvite;
use Drupal\bb_core\Workspace\InviteMatcher;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Confirms joining a workspace one has been invited to.
 *
 * A screen and a POST: a membership must never be provisioned by a GET,
 * which crawlers and link scanners fetch. `access()` refuses foreign
 * invitations on GET; `submitForm()` re-checks, because the POST is reachable
 * without the page. Joining deletes the invitation, whose existence is its
 * pending state.
 *.
 */
final class BbWorkspaceJoinForm extends FormBase {

  use EntityImageTrait;
  use PersonIdentityTrait;

  /**
   * Constructs the join form.
   *
   * @param \Drupal\bb_core\Workspace\InviteMatcher $inviteMatcher
   *   Decides whether an invitation is addressed to the acting account.
   * @param \Drupal\bb_core\Members\InviteAcceptance $acceptance
   *   Applies the invitation's role and team and consumes it.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Loads the acting account. Injected rather than reached through a helper,
   *   because `FormBase` — unlike `ControllerBase` — declares no
   *   `entityTypeManager()`, and it declares no property of that name either,
   *   so promoting one here is safe where `$requestStack` would not be.
   * @param \Drupal\bb_core\Members\WorkspaceInvite $tenancyInvite
   *   Answers whether an invitation has outlived its validity period.
   */
  public function __construct(
    private readonly InviteMatcher $inviteMatcher,
    private readonly InviteAcceptance $acceptance,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly WorkspaceInvite $tenancyInvite,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_core.invite_matcher'),
      $container->get('bb_core.invite_acceptance'),
      $container->get('entity_type.manager'),
      $container->get('bb_core.workspace_invite'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_workspace_join_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?string $bb_invite = NULL): array {
    // The route parameter is raw, not upcast, so a revoked (deleted) id
    // reaches the same "no longer valid" page an expired one does.
    $invite = $this->loadInvite($bb_invite);
    // A revoked or expired invitation gets one sentence and a way out, not a
    // 403. `access()` has already refused a foreign invitation.
    if ($invite === NULL || $this->tenancyInvite->isExpired($invite)) {
      return $this->invalidInvitationPage($form);
    }
    $workspace = $invite->getWorkspace();
    // Carried in the form state so the submit handler does not re-parse the
    // path.
    $form_state->set('bb_invite', $invite);

    // A full document POST, never a boosted fragment: the submit ends in a
    // workspace, so the application shell must replace the gate document.
    $form['#attributes']['data-hx-boost'] = 'false';
    if ($workspace !== NULL) {
      $form['workspace'] = $this->workspaceIdentity($workspace);
    }
    $form['message'] = $this->text($this->t('You have been invited to @workspace. Joining makes you a member of this workspace.', [
      '@workspace' => $workspace?->label() ?? '',
    ]));
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Join'),
      '#theme_wrappers' => ['input__submit__bb_button'],
    ];
    return $form;
  }

  /**
   * The one-sentence "no longer valid" page, same for revoked and expired.
   *
   * @param array<string, mixed> $form
   *   The form being built.
   *
   * @return array<string, mixed>
   *   The form, replaced with the invalid-invitation content.
   */
  private function invalidInvitationPage(array $form): array {
    $form['message'] = $this->text($this->t('This invitation is no longer valid.'));
    $home = Url::fromRoute('bb_core.home')->toString(TRUE);
    $form['home'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => [
        'text' => $this->t('Go to home'),
        'href' => $home->getGeneratedUrl(),
      ],
    ];
    CacheableMetadata::createFromObject($home)->applyTo($form['home']);
    // Nothing left to submit: the actions element core's form-build would
    // otherwise leave behind is simply not added.
    return $form;
  }

  /**
   * The invited workspace's mark and, when it has one, its description.
   *
   * @return array<string, mixed>
   *   The person and text component render arrays.
   */
  private function workspaceIdentity(BbWorkspaceInterface $workspace): array {
    $cache = new CacheableMetadata();
    $name = (string) $workspace->label();
    $build = [
      'mark' => [
        '#type' => 'component',
        '#component' => 'bb_theme:person',
        '#props' => [
          'variant' => 'full',
          'size' => 'md',
          'display_name' => $name,
          'initials' => $this->personInitials($name),
          'color' => $this->personColor((int) $workspace->id()),
          // An invitee is not a member yet, so a private image the account may
          // not download falls back to the initials.
          'picture' => $this->entityImageUrl($workspace, $cache, $this->entityTypeManager),
          'image_fit' => 'contain',
        ],
      ],
    ];
    $description = trim((string) $workspace->get('description')->value);
    if ($description !== '') {
      $build['description'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:text',
        // Escaped here: ui_patterns hands a top-level string prop to Twig as
        // markup, so the template would print a description's tags.
        '#props' => ['text' => Html::escape($description), 'tone' => 'light'],
      ];
    }
    $cache->applyTo($build);
    return $build;
  }

  /**
   * The page's one sentence, in the gate's secondary text treatment.
   *
   * @return array<string, mixed>
   *   A text component render array.
   */
  private function text(TranslatableMarkup $text): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => ['text' => $text, 'tone' => 'light'],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $built = $form_state->get('bb_invite');
    // RELOADED, not trusted from the form state: an invitation revoked after
    // the page rendered must not redeem.
    $invite = $built instanceof BbInvite ? $this->loadInvite((string) $built->id()) : NULL;
    if ($invite === NULL) {
      throw new AccessDeniedHttpException();
    }
    // RE-CHECKED, and this is the half that is the gate. See the class
    // docblock: the POST is reachable without the page having been rendered.
    if (!$this->inviteMatcher->matches($invite, $this->currentUser())) {
      throw new AccessDeniedHttpException();
    }
    // Expiry is refused here too: the POST is reachable without the page.
    if ($this->tenancyInvite->isExpired($invite)) {
      throw new AccessDeniedHttpException();
    }
    $workspace = $invite->getWorkspace();
    if ($workspace === NULL) {
      throw new AccessDeniedHttpException();
    }
    $account = $this->entityTypeManager->getStorage('user')->load($this->currentUser()->id());
    if (!$account instanceof UserInterface) {
      throw new \RuntimeException('The acting session has no loadable account.');
    }

    // Consumes the invitation only when every membership write succeeded; a
    // refusal keeps it for a lead to repair.
    $refusal = $this->acceptance->accept($invite, $workspace, $account);
    if ($refusal !== NULL) {
      $this->messenger()->addError($refusal);
      return;
    }

    $this->messenger()->addStatus($this->t('You have joined @workspace.', [
      '@workspace' => $workspace->label(),
    ]));

    // Joining lands in the workspace just joined, on its My work list; the
    // parameter is the slug, as everywhere. Incomplete accounts never reach
    // this form: the entry guard sends them to the wizard first.
    $form_state->setRedirect(BbHomeController::MY_WORK_ROUTE, ['bb_workspace' => $workspace->getSlug()]);
  }

  /**
   * Whether the acting account may act on this invitation at all.
   *
   * The route's `_custom_access`, so a GET for an invitation addressed to
   * somebody else is a 403 and not a rendered page. The address
   * equality IS the authorisation — an invited person is by definition not yet
   * in the workspace, so no workspace permission could express this.
   *
   * @param string|null $bb_invite
   *   The raw route parameter (not upcast, so a revoked id reaches this
   *   method instead of 404ing), or NULL when the path segment is absent.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   Allowed only for the account the invitation names.
   */
  public function access(?string $bb_invite = NULL): AccessResultInterface {
    $invite = $this->loadInvite($bb_invite);
    // A revoked or unknown id has no address to check; `buildForm()` answers
    // with the "no longer valid" page. A miss does not vary by user.
    if ($invite === NULL) {
      return AccessResult::allowed()->addCacheContexts(['url.path']);
    }
    $allowed = $this->inviteMatcher->matches($invite, $this->currentUser());
    if (!$allowed) {
      // A foreign invitation stays a 403: the address equality is the
      // authorisation, and failing
      // it must not disclose that an invitation with this id exists at all.
      return AccessResult::forbidden('The invitation is addressed to another e-mail address.')
        ->addCacheContexts(['user'])
        ->addCacheableDependency($invite);
    }
    // EXPIRY IS NOT REFUSED HERE. An expired invitation addressed to this
    // account still renders — as the "no longer valid" page `buildForm()`
    // answers with, same sentence a revoked one gets — rather than a 403.
    return AccessResult::allowed()
      ->addCacheContexts(['user'])
      ->addCacheableDependency($invite);
  }

  /**
   * Loads the invitation named by a raw route parameter, tolerating a miss.
   *
   * @param string|null $bb_invite
   *   The raw `{bb_invite}` path segment, or NULL.
   *
   * @return \Drupal\bb_core\Entity\BbInvite|null
   *   The invitation, or NULL when the segment is absent or names nothing —
   *   which is exactly the revoked case this route no longer 404s on.
   */
  private function loadInvite(?string $bb_invite): ?BbInvite {
    if ($bb_invite === NULL || $bb_invite === '') {
      return NULL;
    }
    $invite = $this->entityTypeManager->getStorage('bb_invite')->load($bb_invite);
    return $invite instanceof BbInvite ? $invite : NULL;
  }

}
