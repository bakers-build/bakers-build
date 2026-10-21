<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\bb_core\Members\WorkspaceInvite;
use Drupal\island\Form\WrappedDialogFormBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The invite dialog: several addresses, one workspace role, one team.
 *
 * A dialog rather than a zone of the Members face, by the operator's choice:
 *.
 */
final class WorkspaceInviteForm extends WrappedDialogFormBase implements TrustedCallbackInterface {

  /**
   * The messenger type the Members face renders as its confirmation.
   */
  public const string RESULT_MESSAGE_TYPE = 'bb_invite';

  /**
   * The role name the role picker opens on, where the workspace offers it.
   */
  private const string DEFAULT_ROLE_NAME = 'contributor';

  /**
   * Validates, writes and mails the invitations.
   */
  protected WorkspaceInvite $tenancyInvite;

  /**
   * Loads the workspace's teams.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->tenancyInvite = $container->get('bb_core.workspace_invite');
    $form->entityTypeManager = $container->get('entity_type.manager');
    return $form;
  }

  /**
   * The Members face's "Invite members" button, which opens this dialog.
   *
   * The create-dialog trigger's attributes: `hx-get` through the dialog
   * format into the shell overlay, `href` for a browser without JavaScript.
   *.
   *
   * @return array<string, mixed>
   *   The button.
   */
  public static function trigger(ContentEntityInterface $workspace): array {
    $slug = $workspace instanceof BbWorkspaceInterface ? $workspace->getSlug() : (string) $workspace->id();
    $destination = Url::fromRoute('bb_core.bb_workspace.members', ['bb_workspace' => $slug])->toString();
    $url = static fn (array $query): Url => Url::fromRoute('bb_core.workspace_invite', ['bb_workspace' => $slug], ['query' => $query]);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#attached' => ['library' => ['core/drupal.htmx', 'core/components.bb_theme--option_picker']],
      '#props' => [
        'label' => new TranslatableMarkup('Invite members'),
        'href' => $url(['destination' => $destination])->toString(),
        'variant' => 'primary',
        'attributes' => (new Htmx())
          ->get($url(['destination' => $destination, static::WRAPPER_FORMAT_PARAMETER => static::DIALOG_FORMAT]))
          ->target('#bakers-overlay')
          ->select('dialog')
          ->swap('innerHTML')
          ->getAttributes(),
      ],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_workspace_invite_form';
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['renderPicker'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $workspace = $this->workspace();
    $roles = [];
    foreach (MemberItemBuilder::assignableRoles($workspace) as $role) {
      $roles[(string) $role->id()] = [
        'label' => $role->getLabel(),
        'description' => $this->roleDescription((string) $role->getName()),
      ];
    }
    $teams = array_map(static fn (string $label): array => ['label' => $label, 'description' => ''], $this->teamOptions($workspace));

    $form['#theme'] = 'bb_create_dialog';
    // A line of the form grammar carries no visible label: the placeholder
    // says what it takes, the invisible title names it for assistive tech.
    $form['emails'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Email addresses'),
      '#title_display' => 'invisible',
      '#placeholder' => $this->t('Email addresses, one per line or separated by commas'),
      '#rows' => 4,
      '#picker_region' => 'lines',
    ];
    if ($roles !== []) {
      $form['workspace_role'] = $this->picker($this->t('Workspace role'), 'user', $roles, $this->defaultRole($roles), FALSE);
    }
    $form['team_id'] = $this->picker($this->t('Team'), 'team', $teams, (string) (array_key_first($teams) ?? ''), TRUE);

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
        '#value' => $this->t('Invite'),
        '#theme_wrappers' => ['input__submit__bb_button'],
      ],
    ];
    $form['#attached']['library'][] = 'core/components.bb_theme--option_picker';
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * A single-choice picker element: Form API value, `property_pill` look.
   *
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $label
   *   The pill's field name.
   * @param string $icon
   *   The pill's leading icon.
   * @param array<int|string, array{label: string, description: string}> $options
   *   The rows, keyed by submitted value.
   * @param string $default
   *   The value it opens on; empty for none.
   * @param bool $clearable
   *   Whether "No team" may clear it.
   *
   * @return array<string, mixed>
   *   The element.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function picker(mixed $label, string $icon, array $options, string $default, bool $clearable): array {
    return [
      '#type' => 'bb_picker_value',
      '#title' => $label,
      '#title_display' => 'invisible',
      '#default_value' => $default === '' ? [] : [$default],
      '#picker_region' => 'pills',
      '#picker_label' => (string) $label,
      '#picker_icon' => $icon,
      '#picker_options' => $options,
      '#picker_clear_label' => $clearable ? (string) $this->t('No team') : '',
      '#pre_render' => [[self::class, 'renderPicker']],
    ];
  }

  /**
   * Renders the pill from the processed value, so a refused submit keeps it.
   *
   * @param array<string, mixed> $element
   *   The processed picker element.
   *
   * @return array<string, mixed>
   *   The element with its `control` child.
   */
  public static function renderPicker(array $element): array {
    $value = (string) (($element['#value'] ?? [])[0] ?? '');
    $options = $element['#picker_options'];
    $rows = [];
    foreach ($options as $key => $option) {
      $rows[] = array_filter([
        'value' => (string) $key,
        'label' => $option['label'],
        'description' => $option['description'],
      ]) + ['selected' => (string) $key === $value];
    }
    $clear_label = $element['#picker_clear_label'];
    $element['control'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:property_pill',
      '#props' => [
        'name' => $element['#name'],
        'label' => $element['#picker_label'],
        'icon' => $element['#picker_icon'],
        'picker_id' => $element['#id'],
        'multiple' => FALSE,
        'open' => FALSE,
        'searchable' => count($rows) > 6,
        'value_label' => isset($options[$value]) ? $options[$value]['label'] : $clear_label,
        'values' => isset($options[$value]) ? [$value] : [],
        'clearable' => $clear_label !== '',
        'clear_label' => $clear_label,
        'options' => $rows,
      ],
    ];
    return $element;
  }

  /**
   * The workspace's teams by label, in name order.
   *
   * @return array<int|string, string>
   *   Team labels keyed by id.
   */
  private function teamOptions(BbWorkspaceInterface $workspace): array {
    $storage = $this->entityTypeManager->getStorage('bb_team');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('workspace_id', $workspace->id())
      ->sort('name')
      ->execute();
    $options = [];
    foreach ($storage->loadMultiple($ids) as $team) {
      $options[$team->id()] = (string) $team->label();
    }
    return $options;
  }

  /**
   * One line of what a role grants; empty for a role this form does not know.
   */
  private function roleDescription(string $name): string {
    return (string) match ($name) {
      'member' => $this->t('Belongs to the workspace; no rights of its own.'),
      'guest' => $this->t('Reads the projects of their team.'),
      'contributor' => $this->t("Works on tickets in their team's projects."),
      'lead' => $this->t('Manages members and sees every project.'),
      default => '',
    };
  }

  /**
   * The role the picker opens on: Contributor where offered, else the first.
   *
   * @param array<string, array{label: string, description: string}> $roles
   *   The offered roles keyed by id.
   */
  private function defaultRole(array $roles): string {
    foreach (array_keys($roles) as $id) {
      if (str_ends_with($id, '-' . self::DEFAULT_ROLE_NAME)) {
        return $id;
      }
    }
    return (string) array_key_first($roles);
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $workspace = $this->workspace();
    $screened = $this->tenancyInvite->screen(
      $workspace,
      $this->tenancyInvite->parseAddresses($form_state->getValue('emails')),
      $this->picked($form_state, 'workspace_role'),
      $this->picked($form_state, 'team_id'),
    );
    foreach ($screened['errors'] as $field => $message) {
      $form_state->setErrorByName(isset($form[$field]) ? $field : 'emails', $message);
    }
    $form_state->set('screened', $screened);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $workspace = $this->workspace();
    $screened = $form_state->get('screened');
    foreach ($screened['invite'] as $mail) {
      $this->tenancyInvite->invite($workspace, $mail, $this->picked($form_state, 'workspace_role'), $this->picked($form_state, 'team_id'));
    }
    $message = $this->formatPlural(count($screened['invite']), 'Invited 1 person.', 'Invited @count people.');
    if ($screened['skipped'] !== []) {
      $skipped = [];
      foreach ($screened['skipped'] as $mail => $reason) {
        $skipped[] = $mail . ' (' . $reason . ')';
      }
      $message = $this->t('@invited Skipped: @skipped.', ['@invited' => $message, '@skipped' => implode(', ', $skipped)]);
    }
    $this->messenger()->addMessage($message, self::RESULT_MESSAGE_TYPE);
    if (!$this->isDialogRequest()) {
      $form_state->setRedirectUrl($this->returnUrl());
      return;
    }
    // A whole-document load, not the create dialogs' `HX-Location`: the
    // Members face is an island form, and one swapped in by `HX-Location`
    // posts its next write to the fragment address instead of its own.
    $form_state->setResponse(new Response('', 200, ['HX-Redirect' => $this->returnUrl()->toString()]));
  }

  /**
   * One picker's submitted value: NULL when unset, the scalar otherwise.
   *
   * A non-scalar is passed on as is, for the screen to refuse.
   */
  private function picked(FormStateInterface $form_state, string $key): mixed {
    $value = $form_state->getValue($key);
    if (!is_array($value)) {
      return $value;
    }
    return $value === [] ? NULL : (count($value) === 1 ? reset($value) : $value);
  }

  /**
   * The route's workspace, which the acting account must be able to update.
   */
  private function workspace(): BbWorkspaceInterface {
    $workspace = $this->getRouteMatch()->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface || !$workspace->access('update', $this->currentUser())) {
      throw new AccessDeniedHttpException();
    }
    return $workspace;
  }

}
