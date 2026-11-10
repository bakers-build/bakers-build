<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\Display\EntityFormDisplayInterface;
use Drupal\Core\Entity\Entity\EntityFormDisplay;
use Drupal\Core\Field\EntityReferenceFieldItemListInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Controller\TitleResolverInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbPageTitleSource;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Routing\Route;

/**
 * One card of an entity detail page's inspector.
 *
 * Each card is its own entity form operation with its own Save. The fields
 * come from this server-owned list, never from the request: `edit` fields use
 * the entity's product Settings widgets, `show` fields are read-only rows.
 * Fields the visitor may not edit but may see render read-only too.
 *
 * A save that renames the entity announces the island event
 * `bakers.entity.renamed`; the shell's page header subscribes to it. The
 * document title comes with the card's own answer.
 */
final class BbEntityDetailCardForm extends BbPropertyFormBase {

  /**
   * The island event a renaming save announces.
   */
  public const RENAMED_EVENT = 'bakers.entity.renamed';

  /**
   * Resolves the document title of the card's answer.
   */
  protected TitleResolverInterface $titleResolver;

  /**
   * Card fields keyed by entity type and form operation.
   */
  private const CARDS = [
    'bb_team' => [
      'identity' => ['edit' => ['name'], 'show' => ['workspace_id', 'owner_user_id']],
    ],
    // Group Settings edit a group; its detail cards only show it.
    'bb_group' => [
      'properties' => ['edit' => [], 'show' => ['name', 'workspace_id', 'owner_user_id']],
      'identity' => ['edit' => [], 'show' => ['description']],
    ],
    'bb_machine' => [
      'identity' => [
        'edit' => ['name', 'max_parallel'],
        'show' => ['host_key', 'owner_user_id', 'current_load', 'connection_url'],
      ],
    ],
    // The heartbeat writes status and load; the served states are set at
    // registration and edited here.
    'bb_conductor' => [
      'identity' => [
        'edit' => ['label', 'states'],
        'show' => ['conductor_id', 'project_id', 'machine', 'owner_user_id'],
      ],
    ],
    // Project Settings edit a project; its detail cards only show it.
    'bb_project' => [
      'identity' => ['edit' => [], 'show' => ['name', 'description']],
      'properties' => ['edit' => [], 'show' => ['key', 'repository', 'teams', 'group_id', 'environments']],
    ],
  ];

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = parent::create($container);
    $form->titleResolver = $container->get('title_resolver');
    return $form;
  }

  /**
   * The fields of one card, or NULL when no such card exists.
   *
   * @return array{edit: list<string>, show: list<string>}|null
   *   Editable and read-only field names.
   */
  public static function fields(string $entity_type_id, string $operation): ?array {
    return self::CARDS[$entity_type_id][$operation] ?? NULL;
  }

  /**
   * Entity types with detail cards.
   *
   * @return list<string>
   *   Entity type ids.
   */
  public static function entityTypes(): array {
    return array_keys(self::CARDS);
  }

  /**
   * Every card operation of one entity type.
   *
   * @return list<string>
   *   Form operations.
   */
  public static function operations(string $entity_type_id): array {
    return array_keys(self::CARDS[$entity_type_id] ?? []);
  }

  /**
   * This card's fields.
   *
   * @return array{edit: list<string>, show: list<string>}
   *   Editable and read-only field names.
   */
  private function card(): array {
    $card = self::fields($this->entity->getEntityTypeId(), $this->getOperation());
    if ($card === NULL) {
      throw new \LogicException(sprintf('No detail card %s.%s.', $this->entity->getEntityTypeId(), $this->getOperation()));
    }
    return $card;
  }

  /**
   * {@inheritdoc}
   *
   * The product Settings widgets, narrowed to this card's editable fields.
   */
  protected function init(FormStateInterface $form_state): void {
    parent::init($form_state);
    $this->setFormDisplay($this->cardDisplay(), $form_state);
  }

  /**
   * Builds the card's runtime form display.
   */
  private function cardDisplay(): EntityFormDisplayInterface {
    $edit = $this->card()['edit'];
    $settings = EntityFormDisplay::collectRenderDisplay($this->entity, 'settings');
    $fallback = EntityFormDisplay::collectRenderDisplay($this->entity, 'default');
    $display = $settings->createCopy('bb_card_' . $this->getOperation());
    foreach (array_keys($display->getComponents()) as $field) {
      if (!in_array($field, $edit, TRUE)) {
        $display->removeComponent($field);
      }
    }
    foreach ($edit as $field) {
      if ($display->getComponent($field) === NULL) {
        $display->setComponent($field, $fallback->getComponent($field) ?? []);
      }
    }
    return $display;
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    if (!isset($form['property_baseline'])) {
      return $form;
    }
    $readonly = $this->card()['show'];
    foreach ($this->card()['edit'] as $field) {
      if (!$this->entity->get($field)->access('edit')) {
        $readonly[] = $field;
      }
    }
    $form['readonly'] = $this->rows($readonly) + ['#weight' => 50];
    // Unlike the ticket's property forms, a card's swap takes the document
    // title from its answer, so a rename retitles the browser tab.
    $form['#attributes']['data-hx-swap'] = 'outerHTML';
    $title = $this->documentTitle();
    if ($title !== NULL) {
      $form['#title'] = $title;
    }
    if ($form_state->get('card_title_changed')) {
      $form['#attached']['http_header'][] = ['HX-Trigger', self::RENAMED_EVENT];
      $form_state->set('card_title_changed', FALSE);
    }
    $form['#after_build'][] = '::addRefresh';
    return $form;
  }

  /**
   * Adds the card's own Refresh beside Save, once the form id is known.
   *
   * It fetches the detail page and swaps in this form alone, so other cards
   * keep their unsent input; form-save.js asks first when this card has any.
   */
  public function addRefresh(array $element): array {
    if (!isset($element['actions']['submit'])) {
      return $element;
    }
    $selector = '#' . $element['#id'];
    $attributes = (new Htmx())->get($this->entity->toUrl())->onlyMainContent()
      ->target($selector)->select($selector)->swap('outerHTML')->pushUrl(FALSE)
      ->getAttributes();
    $attributes->setAttribute('data-form-refresh', '');
    $element['actions']['refresh'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'label' => (string) $this->t('Refresh'),
        'variant' => 'neutral',
        'type' => 'button',
        'attributes' => $attributes,
      ],
      '#weight' => -10,
    ];
    return $element;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    // The identity card is where a type without a Settings form is managed.
    $delete = $this->getOperation() === 'identity' && $this->card()['edit'] !== []
      ? BbContentEntityFormBase::deleteAction($this->entity)
      : [];
    if (!$this->entity->access('update')) {
      return $delete;
    }
    foreach ($this->card()['edit'] as $field) {
      if ($this->entity->get($field)->access('edit')) {
        return parent::actions($form, $form_state) + $delete;
      }
    }
    return $delete;
  }

  /**
   * {@inheritdoc}
   */
  protected function editsFields(): bool {
    return $this->card()['edit'] !== [];
  }

  /**
   * {@inheritdoc}
   */
  protected function readOnly(): array {
    return $this->rows(array_merge($this->card()['edit'], $this->card()['show']));
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $before = $this->entityTypeManager->getStorage($this->entity->getEntityTypeId())
      ->loadUnchanged($this->entity->id())?->label();
    $result = parent::save($form, $form_state);
    $form_state->set('card_title_changed', $before !== $this->entity->label());
    // The page around a native POST titles the routed entity: the saved one.
    $this->getRequest()->attributes->set($this->entity->getEntityTypeId(), $this->entity);
    return $result;
  }

  /**
   * The title of a POST answer, as the page itself is titled.
   *
   * NULL on the page's own GET: there the card is not the main content.
   * An htmx answer becomes the document title as it is, so it carries the
   * site name; a native POST's page adds that itself.
   * The canonical route's title callback is asked about the card's entity as
   * just saved; core's entity title would otherwise take the route's first
   * entity parameter, the workspace.
   */
  private function documentTitle(): ?string {
    $route = $this->getRequest()->attributes->get('_route_object');
    if (!$this->getRequest()->isMethod('POST') || !$route instanceof Route) {
      return NULL;
    }
    $request = clone $this->getRequest();
    $request->attributes->set($this->entity->getEntityTypeId(), $this->entity);
    $request->attributes->set('_entity', $this->entity);
    $title = BbPageTitleSource::stringify($this->titleResolver->getTitle($request, $route));
    if (!$request->headers->has('HX-Request')) {
      return $title;
    }
    return $title . ' | ' . $this->config('system.site')->get('name');
  }

  /**
   * Read-only rows of the fields the visitor may see.
   *
   * @param list<string> $fields
   *   Field names in display order.
   *
   * @return array<string, mixed>
   *   The `list` component, or empty when no row is visible.
   */
  private function rows(array $fields): array {
    $items = [];
    foreach ($fields as $field) {
      $list = $this->entity->get($field);
      if (!$list->access('view') || $list->getFieldDefinition()->getType() === 'image') {
        continue;
      }
      $items[] = [
        'cells' => [
          'label' => [
            'kind' => 'text',
            'value' => (string) $list->getFieldDefinition()->getLabel(),
            'emphasis' => 'faint',
          ],
          'value' => $this->cell($list),
        ],
      ];
    }
    if ($items === []) {
      return [];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:list',
      '#props' => ['layout' => 'plain', 'items' => $items],
    ];
  }

  /**
   * One value cell; references show only targets the visitor may see.
   *
   * @return array<string, mixed>
   *   A list cell.
   */
  private function cell(FieldItemListInterface $list): array {
    $empty = ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'];
    if ($list instanceof EntityReferenceFieldItemListInterface) {
      return $this->referenceCell($list) ?? $empty;
    }
    if ($list->getFieldDefinition()->getType() === 'boolean') {
      return ['kind' => 'text', 'value' => (string) ($list->value ? $this->t('Yes') : $this->t('No'))];
    }
    $value = trim($list->getString());
    if ($list->getName() === 'connection_url' && $value !== '') {
      return ['kind' => 'link', 'value' => $value, 'url' => $value];
    }
    return $value === '' ? $empty : ['kind' => 'text', 'value' => $value];
  }

  /**
   * The targets whose label the visitor may see; one linked when viewable.
   *
   * Like core's label formatter: `view label` decides the name, `view` the
   * link, so an owner shows by name to readers who cannot open the account.
   *
   * @return array<string, mixed>|null
   *   A list cell, or NULL when no target is visible.
   */
  private function referenceCell(EntityReferenceFieldItemListInterface $list): ?array {
    $visible = array_values(array_filter(
      $list->referencedEntities(),
      static fn ($target): bool => $target->access('view label'),
    ));
    if ($visible === []) {
      return NULL;
    }
    $target = $visible[0];
    if (count($visible) === 1 && $target->hasLinkTemplate('canonical') && $target->getEntityTypeId() !== 'user'
      && $target->access('view')) {
      return ['kind' => 'link', 'value' => (string) $target->label(), 'url' => $target->toUrl()->toString()];
    }
    return [
      'kind' => 'text',
      'value' => implode(', ', array_map(static fn ($entity): string => (string) $entity->label(), $visible)),
    ];
  }

}
