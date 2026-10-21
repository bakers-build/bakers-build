<?php

declare(strict_types=1);

namespace Drupal\bb_browser_test;

use Drupal\Core\Config\ConfigFactoryInterface;
use GuzzleHttp\Promise\FulfilledPromise;
use GuzzleHttp\Psr7\Response;
use Psr\Http\Message\RequestInterface;

/**
 * Serves recipe-owned upstream fixtures while exercising the real import API.
 */
final class ImportMiddleware {

  /**
   * Constructs the external GitLab boundary fixture.
   */
  public function __construct(private readonly ConfigFactoryInterface $configFactory) {}

  /**
   * Returns the Guzzle middleware callable.
   */
  public function __invoke(): callable {
    $config = $this->configFactory->get('bb_browser_test.import');
    return static function (callable $handler) use ($config): callable {
      return static function (RequestInterface $request, array $options) use ($handler, $config) {
        // Every other integration uses its real client.
        if ($request->getUri()->getHost() !== 'gitlab.api-contract.test') {
          return $handler($request, $options);
        }
        foreach ($config->get('responses') ?? [] as $response) {
          if (str_contains((string) $request->getUri(), $response['match'])) {
            return new FulfilledPromise(new Response(200, [
              'Content-Type' => 'application/json',
              'X-Next-Page' => '',
            ], $response['body']));
          }
        }
        // An incomplete fixture must fail, never contact an external system.
        return new FulfilledPromise(new Response(599, [], 'Unmatched API contract fixture'));
      };
    };
  }

}
