<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * The client-version contract: claims require a current bakers CLI.
 */
#[Group('bb_core')]
final class ClientVersionContractTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image', 'link', 'text', 'bb_core',
  ];

  private const INSTALL_HINT = 'This server requires the bakers CLI (X-Bakers-Client header missing). Install it: npm install -g @bakers-build/bakers';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->config('bb_core.settings')->set('min_client_version', '0.2.0')->save();
  }

  /**
   * A claim without the header is refused with the install hint.
   */
  public function testClaimWithoutHeaderIsUpgradeRequired(): void {
    foreach (['bb_core.claim_next', 'bb_core.ticket_claim'] as $route) {
      $response = $this->requestThrough($this->claimRequest($route));
      $this->assertNotNull($response, $route);
      $this->assertSame(426, $response->getStatusCode());
      $this->assertSame(self::INSTALL_HINT, $this->detailsOf($response)[0]);
    }
  }

  /**
   * A claim from a version below the minimum gets the update hint.
   */
  public function testClaimFromOldVersionIsUpgradeRequired(): void {
    $response = $this->requestThrough($this->claimRequest('bb_core.claim_next', 'bakers/0.1.9'));
    $this->assertNotNull($response);
    $this->assertSame(426, $response->getStatusCode());
    $this->assertSame(
      'bakers 0.1.9 is too old for this server (requires >= 0.2.0). Update: npm install -g @bakers-build/bakers@latest',
      $this->detailsOf($response)[0],
    );
  }

  /**
   * A claim from a current version passes the guard.
   */
  public function testClaimFromCurrentVersionPasses(): void {
    $this->assertNull($this->requestThrough($this->claimRequest('bb_core.claim_next', 'bakers/0.2.0')));
    $this->assertNull($this->requestThrough($this->claimRequest('bb_core.ticket_claim', 'bakers/1.0.0')));
  }

  /**
   * Header-less API errors keep their status and gain the hint.
   */
  public function testOtherErrorWithoutHeaderCarriesHint(): void {
    $body = '{"jsonapi":{"version":"1.0"},"errors":[{"status":"404","title":"Not Found","detail":"gone"}]}';
    $response = $this->respondThrough(Request::create('/jsonapi/bb_ticket/bb_ticket/x'), new Response($body, 404));
    $this->assertSame(404, $response->getStatusCode());
    $this->assertSame(['gone', self::INSTALL_HINT], $this->detailsOf($response));

    // An unknown resource type falls through to the site's HTML 404 page.
    $html = $this->respondThrough(Request::create('/jsonapi/old_ticket/old_ticket/x'), new Response('<html>404</html>', 404));
    $this->assertSame(404, $html->getStatusCode());
    $this->assertSame('application/vnd.api+json', $html->headers->get('Content-Type'));
    $this->assertSame([self::INSTALL_HINT], $this->detailsOf($html));

    $token = $this->respondThrough(
      Request::create('/oauth/token', 'POST'),
      new Response('{"error":"invalid_client","error_description":"Client authentication failed"}', 401),
    );
    $this->assertSame(401, $token->getStatusCode());
    $this->assertSame(
      'Client authentication failed ' . self::INSTALL_HINT,
      json_decode((string) $token->getContent(), TRUE)['error_description'],
    );
  }

  /**
   * Successes, header-carrying clients and other paths stay untouched.
   */
  public function testUntouchedResponses(): void {
    $error = '{"errors":[{"status":"404","detail":"gone"}]}';
    $cases = [
      [Request::create('/jsonapi/bb_ticket/bb_ticket'), new Response('{"data":[]}', 200)],
      [
        Request::create('/jsonapi/x', 'GET', [], [], [], ['HTTP_X_BAKERS_CLIENT' => 'bakers/0.2.0']),
        new Response($error, 404),
      ],
      [Request::create('/mcp', 'POST'), new Response($error, 404)],
      [Request::create('/tickets'), new Response($error, 404)],
    ];
    foreach ($cases as [$request, $response]) {
      $before = $response->getContent();
      $this->assertSame($before, $this->respondThrough($request, $response)->getContent(), $request->getPathInfo());
    }
  }

  /**
   * Builds a routed claim request, optionally carrying the client header.
   */
  private function claimRequest(string $route, ?string $client = NULL): Request {
    $request = Request::create('/jsonapi/bakers/claim-next', 'POST', [], [], [], $client === NULL ? [] : ['HTTP_X_BAKERS_CLIENT' => $client]);
    $request->attributes->set('_route', $route);
    return $request;
  }

  /**
   * Dispatches a request event and returns the response it was given, if any.
   */
  private function requestThrough(Request $request): ?Response {
    $event = new RequestEvent($this->container->get('http_kernel'), $request, HttpKernelInterface::MAIN_REQUEST);
    $this->container->get('bb_core.client_version_subscriber')->onRequest($event);
    return $event->getResponse();
  }

  /**
   * Passes a response through the subscriber and returns it.
   */
  private function respondThrough(Request $request, Response $response): Response {
    $event = new ResponseEvent($this->container->get('http_kernel'), $request, HttpKernelInterface::MAIN_REQUEST, $response);
    $this->container->get('bb_core.client_version_subscriber')->onResponse($event);
    return $event->getResponse();
  }

  /**
   * The error details of a JSON:API error body.
   *
   * @return list<string>
   *   Each error's detail.
   */
  private function detailsOf(Response $response): array {
    return array_column(json_decode((string) $response->getContent(), TRUE)['errors'], 'detail');
  }

}
