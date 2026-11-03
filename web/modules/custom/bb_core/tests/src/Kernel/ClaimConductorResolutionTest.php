<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Resource\ClaimNextResource;
use Drupal\bb_core\Resource\TicketClaimResource;
use Drupal\jsonapi_resources\Resource\EntityResourceBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Claims name their conductor by its UUID; an old CLI's keys are refused.
 */
#[Group('bb_core')]
final class ClaimConductorResolutionTest extends ClaimKernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image',
    'link', 'text', 'serialization', 'jsonapi', 'jsonapi_resources', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['jsonapi']);
  }

  /**
   * A ticket claim runs on the conductor whose UUID the body names.
   */
  public function testTicketClaimResolvesTheConductorByUuid(): void {
    $owner = $this->owner();
    $this->createConductor($owner, 'node-sibling', ['plan', 'working', 'review']);
    $ticket = $this->seedAssignedTicket('plan');

    $response = $this->ticketClaim($owner)->process($this->request(['conductor' => $this->conductor->uuid()]), $ticket);

    $this->assertSame(201, $response->getStatusCode());
    $runs = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadByProperties(['ticket_id' => $ticket->id()]);
    $this->assertCount(1, $runs);
    $run = reset($runs);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $this->assertSame((string) $this->conductor->id(), (string) $run->get('conductor_id')->target_id);
  }

  /**
   * Claim-next finds work for the conductor whose UUID the body names.
   */
  public function testClaimNextResolvesTheConductorByUuid(): void {
    $owner = $this->owner();
    $sibling = $this->createConductor($owner, 'node-sibling', ['plan', 'working', 'review']);
    $ticket = $this->seedAssignedTicket('plan');

    $this->assertSame(204, $this->claimNext($owner)->process($this->request(['conductor' => $sibling->uuid()]))->getStatusCode());
    $response = $this->claimNext($owner)->process($this->request(['conductor' => $this->conductor->uuid()]));

    $this->assertSame(201, $response->getStatusCode());
    $runs = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadByProperties(['ticket_id' => $ticket->id()]);
    $run = reset($runs);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $this->assertSame((string) $this->conductor->id(), (string) $run->get('conductor_id')->target_id);
  }

  /**
   * Another user's conductor UUID resolves to nothing.
   */
  public function testForeignConductorUuidIsNotFound(): void {
    $this->expectException(NotFoundHttpException::class);
    $other = $this->createConductorUser('claim-other-owner');
    $this->claimNext($other)->process($this->request(['conductor' => $this->conductor->uuid()]));
  }

  /**
   * An old CLI's identity or a missing conductor is refused with 422.
   *
   * @param array<string, string> $attributes
   *   The claim attributes.
   * @param string $message
   *   A fragment the refusal must contain.
   */
  #[DataProvider('refusedAttributesProvider')]
  public function testClaimsWithoutTheConductorUuidAreRefused(array $attributes, string $message): void {
    $owner = $this->owner();
    $ticket = $this->seedAssignedTicket('plan');
    $calls = [
      fn () => $this->claimNext($owner)->process($this->request($attributes)),
      fn () => $this->ticketClaim($owner)->process($this->request($attributes), $ticket),
    ];
    foreach ($calls as $call) {
      try {
        $call();
        $this->fail('The claim was accepted.');
      }
      catch (UnprocessableEntityHttpException $e) {
        $this->assertStringContainsString($message, $e->getMessage());
      }
    }
    $this->assertSame(0, (int) $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->getQuery()->accessCheck(FALSE)->count()->execute());
  }

  /**
   * Refused claim attributes.
   *
   * @return array<string, array{array<string, string>, string}>
   *   Attributes and the expected message fragment.
   */
  public static function refusedAttributesProvider(): array {
    return [
      'conductor_id' => [['conductor_id' => 'cw-framework'], 'bakers init'],
      'machine_id' => [['machine_id' => 'cw-laptop'], 'bakers init'],
      'no conductor' => [[], 'conductor'],
    ];
  }

  /**
   * The owner of the shared conductor.
   */
  private function owner(): UserInterface {
    $owner = $this->conductor->get('owner_user_id')->entity;
    $this->assertInstanceOf(UserInterface::class, $owner);
    return $owner;
  }

  /**
   * The claim-next resource acting as an account.
   */
  private function claimNext(AccountInterface $account): ClaimNextResource {
    return $this->wire(new ClaimNextResource($this->container->get('entity_type.manager'), $account, $this->claimService));
  }

  /**
   * The ticket claim resource acting as an account.
   */
  private function ticketClaim(AccountInterface $account): TicketClaimResource {
    return $this->wire(new TicketClaimResource($this->container->get('entity_type.manager'), $account, $this->claimService));
  }

  /**
   * Calls the setters the router would call.
   *
   * @param T $resource
   *   The resource.
   *
   * @return T
   *   The resource.
   *
   * @template T of \Drupal\jsonapi_resources\Resource\EntityResourceBase
   */
  private function wire(EntityResourceBase $resource): EntityResourceBase {
    $resource->setResourceResponseFactory($this->container->get('jsonapi_resources.resource_response_factory'));
    $resource->setDocumentExtractor($this->container->get('jsonapi_resources.document_extractor'));
    $resource->setResourceTypeRepository($this->container->get('jsonapi.resource_type.repository'));
    $resource->setEntityAccessChecker($this->container->get('jsonapi_resources.entity_access_checker'));
    return $resource;
  }

  /**
   * A claim request carrying the attributes.
   *
   * @param array<string, string> $attributes
   *   The data.attributes map.
   */
  private function request(array $attributes): Request {
    return Request::create('/jsonapi/bakers/claim-next', 'POST', [], [], [], [],
      json_encode(['data' => ['attributes' => $attributes]], JSON_THROW_ON_ERROR));
  }

}
