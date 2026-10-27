<?php

declare(strict_types=1);

namespace Drupal\bb_core\Resource;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\TicketTemplate\TemplateNotFoundException;
use Drupal\bb_core\TicketTemplate\TicketTemplateAccessDeniedException;
use Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator;
use Drupal\bb_core\TicketTemplate\TicketTemplateValidationException;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Creates a ticket from a template, with optional per-field overrides.
 *
 * The optional body is a JSON:API `bb_ticket--bb_ticket` document without
 * an id: attributes `title`, `description`, `workflow`; relationships
 * `project_id`, `conductor_id`, `labels` by UUID; `meta.target_state`. Every
 * call answers 201 with the new ticket and `meta.created: true`.
 */
final class TicketTemplateInstantiateResource extends EntityResourceBase implements ContainerInjectionInterface {

  private const ATTRIBUTES = ['title', 'description', 'workflow'];

  /**
   * Overridable relationships and their target entity types.
   *
   * @var array<string, string>
   */
  private const RELATIONSHIPS = [
    'project_id' => 'bb_project',
    'conductor_id' => 'bb_conductor',
    'ticket_type' => 'bb_term',
    'recipe' => 'bb_term',
    'labels' => 'bb_term',
  ];

  /**
   * Constructs a TicketTemplateInstantiateResource.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager.
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   The current user account.
   * @param \Drupal\bb_core\TicketTemplate\TicketTemplateInstantiator $instantiator
   *   The instantiator.
   * @param \Drupal\Core\Entity\EntityRepositoryInterface $entityRepository
   *   The entity repository, to resolve relationship UUIDs.
   */
  public function __construct(
    EntityTypeManagerInterface $entity_type_manager,
    private readonly AccountInterface $currentUser,
    private readonly TicketTemplateInstantiator $instantiator,
    private readonly EntityRepositoryInterface $entityRepository,
  ) {
    $this->entityTypeManager = $entity_type_manager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('bb_core.ticket_template_instantiator'),
      $container->get('entity.repository'),
    );
  }

  /**
   * Handles the instantiate POST request.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request; its optional body carries the overrides.
   * @param \Drupal\bb_core\Entity\BbTicketTemplateInterface $bb_ticket_template
   *   The template, resolved from the URL.
   */
  public function process(Request $request, BbTicketTemplateInterface $bb_ticket_template): ResourceResponse {
    $overrides = $this->overrides(trim($request->getContent()));
    try {
      $result = $this->instantiator->instantiate($bb_ticket_template->uuid(), $this->currentUser, $overrides);
    }
    catch (TemplateNotFoundException $e) {
      throw new NotFoundHttpException($e->getMessage(), $e);
    }
    catch (TicketTemplateAccessDeniedException $e) {
      throw new AccessDeniedHttpException($e->getMessage(), $e);
    }
    catch (TicketTemplateValidationException $e) {
      throw new UnprocessableEntityHttpException($e->getMessage(), $e);
    }
    $ticket = $this->entityTypeManager->getStorage('bb_ticket')
      ->loadByProperties(['uuid' => $result['ticket_uuid']]);
    $ticket = reset($ticket);
    assert($ticket instanceof BbTicketInterface);
    return $this->createJsonapiResponse(
      $this->createIndividualDataFromEntity($ticket),
      $request,
      201,
      [],
      NULL,
      ['created' => TRUE],
    );
  }

  /**
   * Maps the request body to instantiator overrides.
   *
   * @return array<string, mixed>
   *   The overrides; empty for an empty body.
   */
  private function overrides(string $content): array {
    if ($content === '' || $content === '{}') {
      return [];
    }
    $document = json_decode($content, TRUE);
    $data = is_array($document) ? ($document['data'] ?? NULL) : NULL;
    if (!is_array($data) || ($data['type'] ?? NULL) !== 'bb_ticket--bb_ticket' || array_key_exists('id', $data)) {
      throw new BadRequestHttpException('The body must be a bb_ticket--bb_ticket document without an id.');
    }
    $overrides = $this->attributeOverrides((array) ($data['attributes'] ?? []))
      + $this->relationshipOverrides((array) ($data['relationships'] ?? []));
    if (isset($document['meta']['target_state'])) {
      $overrides['target_state'] = self::string('target_state', $document['meta']['target_state']);
    }
    return $overrides;
  }

  /**
   * The attribute overrides; `description` may be a string or `{value}`.
   *
   * @param array<string, mixed> $attributes
   *   The document's attributes.
   *
   * @return array<string, mixed>
   *   The overrides.
   */
  private function attributeOverrides(array $attributes): array {
    $unknown = array_diff(array_keys($attributes), self::ATTRIBUTES);
    if ($unknown !== []) {
      throw new UnprocessableEntityHttpException(sprintf('Field %s cannot be set from a template.', implode(', ', $unknown)));
    }
    if (is_array($attributes['description'] ?? NULL)) {
      $attributes['description'] = $attributes['description']['value'] ?? '';
    }
    foreach ($attributes as $field => $value) {
      $attributes[$field] = self::string($field, $value);
    }
    return $attributes;
  }

  /**
   * Returns a string value, or answers 422 for any other type.
   */
  private static function string(string $field, mixed $value): string {
    if (!is_string($value)) {
      throw new UnprocessableEntityHttpException(sprintf('Field %s must be a string.', $field));
    }
    return $value;
  }

  /**
   * The relationship overrides, UUIDs mapped to entity ids.
   *
   * @param array<string, mixed> $relationships
   *   The document's relationships.
   *
   * @return array<string, mixed>
   *   The overrides.
   */
  private function relationshipOverrides(array $relationships): array {
    $unknown = array_diff(array_keys($relationships), array_keys(self::RELATIONSHIPS));
    if ($unknown !== []) {
      throw new UnprocessableEntityHttpException(sprintf('Field %s cannot be set from a template.', implode(', ', $unknown)));
    }
    $overrides = [];
    foreach ($relationships as $field => $relationship) {
      $linkage = is_array($relationship) ? ($relationship['data'] ?? NULL) : NULL;
      $overrides[$field] = match (TRUE) {
        $field === 'labels' => array_map(fn ($item): int => $this->resolve($field, $item), (array) $linkage),
        $linkage === NULL => NULL,
        default => $this->resolve($field, $linkage),
      };
    }
    return $overrides;
  }

  /**
   * Resolves one resource identifier to an entity id, or answers 422.
   */
  private function resolve(string $field, mixed $identifier): int {
    $uuid = is_array($identifier) ? ($identifier['id'] ?? NULL) : NULL;
    $entity = is_string($uuid) ? $this->entityRepository->loadEntityByUuid(self::RELATIONSHIPS[$field], $uuid) : NULL;
    if ($entity === NULL) {
      throw new UnprocessableEntityHttpException(sprintf('The %s relationship names no known entity.', $field));
    }
    return (int) $entity->id();
  }

}
