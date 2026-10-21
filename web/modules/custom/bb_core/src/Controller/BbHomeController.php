<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Routing\LocalRedirectResponse;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\EntityImageTrait;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Workspace\InviteMatcher;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpFoundation\Response;

/**
 * The landing screen: one workspace's My work, or the choice between several.
 *
 * `/` and `/home` both reach this. One candidate on `/` redirects to its My
 * work list; otherwise the overview renders (chooser, joinable invitations,
 * empty state, create action). The bypass branch is needed because the
 * install-time default workspace has no membership. The `gate` page layout
 * supplies the chrome.
 *.
 */
final class BbHomeController extends ControllerBase {

  use EntityImageTrait;
  use PersonIdentityTrait;

  /**
   * The route the single-candidate answer redirects to.
   *
   * The tickets VIEW's `my_work` page display registers it; there is no
   * `bb_core.tickets` PHP route and `bb_core.routing.yml` closes with an
   * explicit prohibition against re-adding one.
   */
  public const MY_WORK_ROUTE = 'view.tickets.my_work';

  /**
   * The route that creates a workspace.
   *
   * With it comes the workspace's whole shape — its first team and both
   * memberships, provisioned atomically alongside it.
   */
  public const CREATE_ROUTE = 'bb_core.workspace_create';

  /**
   * The route that confirms joining an invited workspace.
   */
  public const JOIN_ROUTE = 'bb_core.workspace_join';

  /**
   * The marker the landing body carries, so a browser check can anchor on it.
   *
   * Its VALUE says which of the 200 answers was rendered — `chooser` or
   * `joinable` — because those are the answers a defect swaps for one another
   * and a bare presence check cannot tell apart.
   */
  public const BODY_ATTRIBUTE = 'data-bakers-home-body';

  /**
   * Constructs the landing controller.
   *
   * @param \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface $readScope
   *   Resolves both the membership set and the bypass.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Loads the candidate workspaces.
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   The operator whose scope decides the answer.
   * @param \Drupal\bb_core\Workspace\InviteMatcher $inviteMatcher
   *   Finds the invitations addressed to this operator's own e-mail address.
   * @param \Symfony\Component\HttpFoundation\RequestStack $requestStack
   *   Tells `/` from `/home`, which is what decides whether the
   *   single-workspace answer is a redirect or the overview.
   */
  public function __construct(
    private readonly BbWorkspaceReadScopeInterface $readScope,
    EntityTypeManagerInterface $entityTypeManager,
    AccountInterface $currentUser,
    private readonly InviteMatcher $inviteMatcher,
    private readonly RequestStack $requestStack,
  ) {
    // Assigned rather than promoted: ControllerBase already declares both, and
    // a promoted readonly property cannot redeclare a non-readonly parent one.
    $this->entityTypeManager = $entityTypeManager;
    $this->currentUser = $currentUser;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_core.workspace_read_scope'),
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('bb_core.invite_matcher'),
      $container->get('request_stack'),
    );
  }

  /**
   * Redirects into the one candidate workspace, or renders the chooser.
   *
   * @return array<string, mixed>|\Symfony\Component\HttpFoundation\Response
   *   A 302 when exactly one workspace is a candidate; otherwise the render
   *   array of the chooser or of the named absence.
   */
  public function land(): array|Response {
    $candidates = $this->candidates();
    $joinable = $this->joinable($candidates);
    $cacheability = $this->cacheability();

    // Redirect only on `/` ("take me to my work"); `/home` must stay
    // reachable for a one-workspace operator. An invitation always outranks
    // the redirect, so the offer is never skipped.
    if ($this->isSiteRoot() && count($candidates) === 1 && $joinable === []) {
      $response = new LocalRedirectResponse($this->myWorkUrl(reset($candidates)));
      $response->addCacheableDependency($cacheability);
      return $response;
    }

    $build = $this->overview($candidates, $joinable);
    // Merged, not replaced: the rows carry each workspace image's access.
    CacheableMetadata::createFromRenderArray($build)->merge($cacheability)->applyTo($build);
    return $build;
  }

  /**
   * Whether this request came in on `/` rather than on `/home`.
   *
   * READ FROM THE PATH AND NOT FROM THE ROUTE, because both addresses resolve
   * to the SAME route: `system.site.front` is `/home`, so Drupal serves the
   * front page at `/` without redirecting and the route name is
   * `bb_core.home` either way. The path is the only thing that still tells
   * the two questions apart.
   *
   * @return bool
   *   TRUE when the visitor asked for the site root.
   */
  private function isSiteRoot(): bool {
    return $this->requestStack->getCurrentRequest()?->getPathInfo() === '/';
  }

  /**
   * The invitations worth offering: for this account, minus what it holds.
   *
   * An invitation to a workspace the person is already in is a leftover row,
   * not an offer; its join would only be refused.
   *
   * @param array<\Drupal\bb_core\Entity\BbWorkspaceInterface> $candidates
   *   The workspaces this account is already a member of.
   *
   * @return array<\Drupal\bb_core\Entity\BbInvite>
   *   The invitations to offer.
   */
  private function joinable(array $candidates): array {
    $held = [];
    foreach ($candidates as $workspace) {
      $held[] = $workspace->id();
    }
    return $this->inviteMatcher->offersForAccount($this->currentUser, $held);
  }

  /**
   * The workspaces this operator may land in, ordered by slug ascending.
   *
   * @return array<\Drupal\bb_core\Entity\BbWorkspaceInterface>
   *   The candidates, re-indexed from zero.
   */
  private function candidates(): array {
    $storage = $this->entityTypeManager()->getStorage('bb_workspace');

    // Asked as a permission check rather than by reading the shape of a
    // condition group: `buildConditions()` returns an empty group both for a
    // holder of the admin permission and for a holder of `view
    // bb_workspace`, so the shape cannot tell the two apart.
    // NULL means "every workspace": `loadMultiple(NULL)` is core's own spelling
    // of that, so the bypass branch needs no second call site.
    $ids = NULL;
    if (!$this->readScope->isBypassed($this->currentUser, 'bb_workspace')) {
      $ids = $this->readScope->workspaceIds($this->currentUser);
      if ($ids === []) {
        return [];
      }
    }
    $workspaces = $storage->loadMultiple($ids);

    $candidates = [];
    foreach ($workspaces as $workspace) {
      if ($workspace instanceof BbWorkspaceInterface) {
        $candidates[] = $workspace;
      }
    }
    usort(
      $candidates,
      static fn (BbWorkspaceInterface $a, BbWorkspaceInterface $b): int
        => strcmp((string) $a->getSlug(), (string) $b->getSlug()),
    );
    return $candidates;
  }

  /**
   * The public My work address of one workspace.
   *
   * THE PARAMETER IS THE SLUG, NOT THE ID. The route declares
   * `bb_core.paramconverter.workspace_slug`, so an id arrives as an unknown
   * slug, fails to upcast and produces a 404 behind a URL that looks correct.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace to address.
   *
   * @return string
   *   The generated URL, in its public `/{slug}/tickets` form.
   */
  private function myWorkUrl(BbWorkspaceInterface $workspace): string {
    return Url::fromRoute(
      self::MY_WORK_ROUTE,
      ['bb_workspace' => $workspace->getSlug()],
    )->toString();
  }

  /**
   * The chooser: one card per workspace, each a link into its My work list.
   *
   * `items` IS AN ARRAY PROP, and that is why nothing here trusts the build.
   * ui_patterns' `CompatibilityChecker` ignores object properties and mistypes
   * array props, `display_builder` drops an invalid SDC prop silently, and the
   * Storybook build validates no props at all — so a green build says nothing
   * about this payload and every assertion on it is made against the rendered
   * output.
   *
   * @param array<\Drupal\bb_core\Entity\BbWorkspaceInterface> $candidates
   *   The workspaces to offer, already ordered.
   * @param array<\Drupal\bb_core\Entity\BbInvite> $joinable
   *   The invitations to offer as joinable rows, already filtered.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function overview(array $candidates, array $joinable): array {
    $cache = new CacheableMetadata();
    $items = [];
    foreach ($candidates as $workspace) {
      $url = $this->myWorkUrl($workspace);
      $items[] = [
        'url' => $url,
        'cells' => $this->identityCells($workspace, $cache) + [
          'workspace' => [
            'kind' => 'link',
            'value' => $workspace->label(),
            'url' => $url,
          ],
          'slug' => [
            'kind' => 'mono',
            'value' => $workspace->getSlug(),
          ],
        ] + $this->descriptionCell($workspace),
      ];
    }
    foreach ($joinable as $invite) {
      $workspace = $invite->getWorkspace();
      $joinUrl = Url::fromRoute(self::JOIN_ROUTE, ['bb_invite' => $invite->id()])->toString();
      $items[] = [
        'url' => $joinUrl,
        'cells' => ($workspace ? $this->identityCells($workspace, $cache) : []) + [
          // THE WORKSPACE NAME IS NOT A LINK HERE, and that is the difference
          // between a row you hold and a row you are offered:
          // `BbWorkspaceAccessCheck` turns a workspace outside the reader's
          // scope into a 404, and an invited person is BY DEFINITION not in it
          // yet — so linking the name would offer them a page not found.
          'workspace' => [
            'kind' => 'text',
            'value' => $workspace?->label() ?? '',
            'emphasis' => 'strong',
          ],
          'slug' => [
            'kind' => 'mono',
            'value' => $workspace?->getSlug() ?? '',
          ],
        ] + ($workspace ? $this->descriptionCell($workspace) : []) + [
          // A `link` cell, not `kind: action`: the action macro only renders
          // an inert `<button type="button">`, and this is a navigation to the
          // confirm form. `full_load` opts out of the gate's htmx boost, which
          // would leave the form's `#action` placeholder unreplaced (404).
          'join' => [
            'kind' => 'link',
            'value' => $this->t('Join @workspace', ['@workspace' => $workspace?->label() ?? '']),
            'url' => $joinUrl,
            'full_load' => TRUE,
          ],
        ],
      ];
    }

    // A zone rather than a bare container: its `md` gap is what separates the
    // create action from the list or empty state above it.
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => [
        'inset' => 'none',
        'gap' => 'md',
        'attributes' => new Attribute([
          // `joinable` WINS OVER `chooser` when both are present, because it is
          // the answer a defect would swap: a chooser rendered where an
          // invitation exists looks like a working screen with the offer
          // missing.
          self::BODY_ATTRIBUTE => $this->bodyKind($items, $joinable),
        ]),
      ],
      '#slots' => [
        'content' => [
          'chooser' => $items === []
            ? [
              '#type' => 'component',
              '#component' => 'bb_theme:empty-state',
              '#props' => [
                'message' => $this->t('No workspace yet. Create one, or join one if you have an invitation.'),
              ],
            ]
            : [
              '#type' => 'component',
              '#component' => 'bb_theme:list',
              '#props' => [
                'layout' => 'cards',
                'items' => $items,
              ],
            ],
          'setup_guide' => $this->setupGuide(),
          'create' => $this->createAction(),
        ],
      ],
    ];
    $cache->applyTo($build);
    return $build;
  }

  /**
   * A workspace's leading mark: its image where the reader may see it.
   *
   * An invitee is not a member yet, so a private image they may not download
   * falls back to the initials.
   *
   * @return array<string, array<string, string>>
   *   The `mark` cell.
   */
  private function identityCells(BbWorkspaceInterface $workspace, CacheableMetadata $cache): array {
    return [
      'mark' => [
        'kind' => 'person',
        'size' => 'md',
        'initials' => $this->personInitials((string) $workspace->label()),
        'color' => $this->personColor((int) $workspace->id()),
        'picture' => $this->entityImageUrl($workspace, $cache, $this->entityTypeManager()),
        'image_fit' => 'contain',
      ],
    ];
  }

  /**
   * The workspace's description as a faint cell, or nothing.
   *
   * @return array<string, array<string, string>>
   *   The `description` cell, absent when there is no description.
   */
  private function descriptionCell(BbWorkspaceInterface $workspace): array {
    $description = trim((string) $workspace->get('description')->value);
    return $description === '' ? [] : [
      'description' => ['kind' => 'text', 'value' => $description, 'emphasis' => 'faint'],
    ];
  }

  /**
   * Which overview body the page rendered.
   *
   * @param array<int, mixed> $items
   *   Chooser and joinable rows already merged.
   * @param array<int, mixed> $joinable
   *   Pending invitations.
   *
   * @return string
   *   `empty`, `joinable` or `chooser`.
   */
  private function bodyKind(array $items, array $joinable): string {
    if ($items === []) {
      return 'empty';
    }
    return $joinable === [] ? 'chooser' : 'joinable';
  }

  /**
   * Reopens the setup pages of the onboarding wizard.
   *
   * Always present, including when the account holds no workspace. Boost is
   * off so the wizard form posts to a real document the way Create does.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function setupGuide(): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#variant' => 'ghost',
      '#props' => [
        'label' => $this->t('Setup guide'),
        'href' => Url::fromRoute('bb_core.onboarding')->toString(),
        'attributes' => new Attribute(['data-hx-boost' => 'false']),
      ],
    ];
  }

  /**
   * The create affordance, identical in both answers that carry it.
   *
   * A button with `href` renders a real `<a>`, so it works without JavaScript.
   * `data-hx-boost="false"` is load-bearing: a boosted navigation arrives as a
   * fragment whose form `#action` placeholder is never replaced, and the
   * create form would post to `form_action_p_…` and 404.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function createAction(): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#variant' => 'primary',
      '#props' => [
        'label' => $this->t('Create a new workspace'),
        'href' => Url::fromRoute(self::CREATE_ROUTE)->toString(),
        'attributes' => new Attribute(['data-hx-boost' => 'false']),
      ],
    ];
  }

  /**
   * What the answer depends on.
   *
   * The same three dependencies `BbWorkspaceAccessCheck` declares, because it
   * is the same question: the `user` context because the answer is per account,
   * and the two list tags because a new membership or a new workspace changes
   * which of the three answers is right.
   *
   * @return \Drupal\Core\Cache\CacheableMetadata
   *   The metadata both answers carry.
   */
  private function cacheability(): CacheableMetadata {
    return (new CacheableMetadata())
      ->setCacheContexts(['user'])
      // A new or consumed invitation changes which answer is right, too.
      ->setCacheTags(['og_membership_list', 'bb_workspace_list', 'bb_invite_list']);
  }

}
