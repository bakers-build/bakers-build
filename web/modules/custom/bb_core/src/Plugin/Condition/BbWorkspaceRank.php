<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Condition;

use Drupal\Core\Condition\Attribute\Condition;
use Drupal\Core\Condition\ConditionPluginBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\MembershipResolutionGuard;
use Drupal\bb_core\ContextProvider\BbRouteContextProvider;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\MembershipManagerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Matches the current account's rank in the mapped workspace.
 */
#[Condition(
  id: 'bb_workspace_rank',
  label: new TranslatableMarkup('bakers.build workspace rank'),
  context_definitions: [
    'workspace' => new EntityContextDefinition(
      data_type: 'entity:bb_workspace',
      label: new TranslatableMarkup('Workspace'),
      required: FALSE,
    ),
  ],
)]
final class BbWorkspaceRank extends ConditionPluginBase implements ContainerFactoryPluginInterface {

  /**
   * The OG role id prefix of workspace ranks.
   */
  private const ROLE_PREFIX = 'bb_workspace-bb_workspace-';

  /**
   * The selectable ranks; `non-member` means no active membership.
   */
  public const RANKS = ['lead', 'contributor', 'guest', 'non-member'];

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    private readonly AccountInterface $account,
    private readonly ?MembershipManagerInterface $membershipManager,
    private readonly MembershipResolutionGuard $guard,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('current_user'),
      $container->has('og.membership_manager') ? $container->get('og.membership_manager') : NULL,
      $container->get('bb_core.membership_resolution_guard'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration(): array {
    return ['ranks' => []] + parent::defaultConfiguration();
  }

  /**
   * {@inheritdoc}
   */
  public function getContextMapping(): array {
    return array_filter(parent::getContextMapping()) + ['workspace' => BbRouteContextProvider::AMBIENT_WORKSPACE];
  }

  /**
   * {@inheritdoc}
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state): array {
    $form['ranks'] = [
      '#type' => 'checkboxes',
      '#title' => $this->t('Workspace ranks'),
      '#options' => [
        'lead' => $this->t('Lead'),
        'contributor' => $this->t('Contributor'),
        'guest' => $this->t('Guest'),
        'non-member' => $this->t('Non-member'),
      ],
      '#default_value' => $this->configuration['ranks'],
    ];
    return parent::buildConfigurationForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state): void {
    $this->configuration['ranks'] = array_values(array_intersect(self::RANKS, array_filter((array) $form_state->getValue('ranks'))));
    parent::submitConfigurationForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   *
   * @throws \RuntimeException
   *   When memberships cannot be resolved; the caller must deny.
   */
  public function evaluate(): bool {
    if ($this->configuration['ranks'] === []) {
      return TRUE;
    }
    $workspace = $this->getContextValue('workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      return FALSE;
    }
    if ($this->membershipManager === NULL) {
      throw new \RuntimeException('Workspace ranks need the OG membership manager.');
    }
    $membership = $this->guard->resolving(
      fn () => $this->membershipManager->getMembership($workspace, (int) $this->account->id()),
    );
    if ($membership === NULL) {
      return in_array('non-member', $this->configuration['ranks'], TRUE);
    }
    $ranks = array_map(
      static fn (string $role): string => substr($role, strlen(self::ROLE_PREFIX)),
      array_filter($membership->getRolesIds(), static fn (string $role): bool => str_starts_with($role, self::ROLE_PREFIX)),
    );
    return array_intersect($ranks, array_diff($this->configuration['ranks'], ['non-member'])) !== [];
  }

  /**
   * {@inheritdoc}
   */
  public function summary(): string {
    return (string) $this->t('The account ranks as @ranks in the workspace.', ['@ranks' => implode(', ', $this->configuration['ranks'])]);
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    return array_merge(parent::getCacheContexts(), ['bb_workspace', 'user', 'user.roles']);
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheTags(): array {
    return array_merge(parent::getCacheTags(), ['og_membership_list', 'config:og_role_list']);
  }

}
