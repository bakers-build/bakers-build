<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Decodes gzip JSON:API POST/PATCH bodies for bb_run writes.
 *
 * Identity writes and other entity types are left untouched. Access has
 * already been decided by the router before this runs.
 */
final class RunLogCompressionSubscriber implements EventSubscriberInterface {

  /**
   * JSON:API collection create for bb_run.
   */
  private const POST_ROUTE = 'jsonapi.bb_run--bb_run.collection.post';

  /**
   * JSON:API individual update for bb_run.
   */
  private const PATCH_ROUTE = 'jsonapi.bb_run--bb_run.individual.patch';

  /**
   * Expanded JSON ceiling passed to gzdecode().
   */
  private const MAX_DECODE_BYTES = 64 * 1024 * 1024;

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // After the router (32) and auth filter (31), before the controller.
    return [KernelEvents::REQUEST => ['onRequest', 20]];
  }

  /**
   * Replaces a gzip run-write body with the decoded JSON, or rejects it.
   */
  public function onRequest(RequestEvent $event): void {
    if (!$this->isRunWriteRequest($event)) {
      return;
    }
    $request = $event->getRequest();
    $parts = $this->contentEncodingParts($request);
    if ($parts === []) {
      return;
    }
    if ($parts !== ['gzip']) {
      $event->setResponse($this->reject(415));
      return;
    }
    $decoded = $this->decodeGzipBody($request->getContent());
    if ($decoded === NULL) {
      $event->setResponse($this->reject(400));
      return;
    }
    $this->replaceContent($request, $decoded);
  }

  /**
   * Whether this is a main JSON:API POST/PATCH of a bb_run.
   */
  private function isRunWriteRequest(RequestEvent $event): bool {
    if (!$event->isMainRequest()) {
      return FALSE;
    }
    $request = $event->getRequest();
    $method = $request->getMethod();
    if ($method !== 'POST' && $method !== 'PATCH') {
      return FALSE;
    }
    $route = $request->attributes->get('_route');
    return $route === self::POST_ROUTE || $route === self::PATCH_ROUTE;
  }

  /**
   * Tokenizes Content-Encoding; empty means identity (no header).
   *
   * @return list<string>
   *   Encoding tokens, or an empty list when the header is absent.
   */
  private function contentEncodingParts(Request $request): array {
    $encoding = $request->headers->get('Content-Encoding');
    if ($encoding === NULL || $encoding === '') {
      return [];
    }
    return array_values(array_filter(
      array_map(
        static fn(string $part): string => strtolower(trim($part)),
        explode(',', $encoding),
      ),
      static fn(string $part): bool => $part !== '',
    ));
  }

  /**
   * Decodes a gzip body or returns NULL when it is invalid or oversize.
   *
   * @SuppressWarnings("PHPMD.ErrorControlOperator")
   */
  private function decodeGzipBody(string $content): ?string {
    $decoded = @gzdecode($content, self::MAX_DECODE_BYTES);
    if ($decoded === FALSE || strlen($decoded) > self::MAX_DECODE_BYTES) {
      return NULL;
    }
    return $decoded;
  }

  /**
   * Re-initializes the request with decoded JSON, keeping bags and format.
   */
  private function replaceContent(Request $request, string $decoded): void {
    $format = $request->getRequestFormat(NULL);
    $headers = $request->headers->all();
    unset($headers['content-encoding']);
    $headers['content-length'] = [(string) strlen($decoded)];
    $server = $request->server->all();
    unset($server['HTTP_CONTENT_ENCODING']);
    $server['CONTENT_LENGTH'] = (string) strlen($decoded);
    $request->initialize(
      $request->query->all(),
      $request->request->all(),
      $request->attributes->all(),
      $request->cookies->all(),
      $request->files->all(),
      $server,
      $decoded,
    );
    $request->headers->replace($headers);
    if ($format !== NULL) {
      $request->setRequestFormat($format);
    }
  }

  /**
   * Generic rejection: private/no-store, empty body, no payload.
   */
  private function reject(int $status): Response {
    return new Response('', $status, [
      'Cache-Control' => 'private, no-store',
    ]);
  }

}
