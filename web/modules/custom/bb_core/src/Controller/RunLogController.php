<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\RunLog\RunLogException;
use Symfony\Component\HttpFoundation\AcceptHeader;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Serves a run log to a user who may read the run's logs.
 *
 * Authorization is the route's `_entity_access: bb_run.view_log` requirement
 * and nothing else, so there is no second permission vocabulary that could
 * drift from the first. Files on disk are gzip (or leftover plaintext
 * `.log`); this gate is the only thing protecting them. Downloads negotiate
 * gzip vs identity of the decoded plaintext.
 */
final class RunLogController extends ControllerBase {

  /**
   * Streams the requested log kind ('log' or 'error_log') for a run.
   *
   * @param \Drupal\bb_core\Entity\BbRunInterface $bb_run
   *   The run whose log is requested.
   * @param string $kind
   *   Log or error_log.
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request, for Accept-Encoding negotiation.
   *
   * @return \Symfony\Component\HttpFoundation\Response
   *   The download, 204, 406, or 500.
   */
  public function download(BbRunInterface $bb_run, string $kind, Request $request): Response {
    // Review finding I6: these two headers apply to EVERY response this
    // action returns, the error branches included. A run's existence and
    // whether its log is currently readable are both confidential facts, so
    // an error response must not enter a shared cache any more than a
    // successful one may.
    $headers = [
      'X-Content-Type-Options' => 'nosniff',
      'Cache-Control' => 'private, no-store, max-age=0',
      'Vary' => 'Accept-Encoding',
    ];
    try {
      $payload = $kind === 'error_log' ? $bb_run->readErrorLog() : $bb_run->readLog();
    }
    catch (RunLogException) {
      // No detail in the body: the failure mode (checksum mismatch, missing
      // directory, unreadable file) is server-side bookkeeping, not something
      // a caller of this route needs, or should get, to see.
      return new Response('', 500, $headers);
    }
    if ($payload === NULL) {
      // CR2: distinct from a routing/access 404 — this run simply has no log
      // file of this kind referenced yet. A plain 404 here was
      // indistinguishable from "the route didn't resolve", so bakers-cli's
      // fetcher (and any other
      // client) could not tell "no transcript" apart from "something is
      // broken" and silently treated both as empty. 204 is the unambiguous
      // "nothing to return" signal; 404 is reserved for the route/entity not
      // resolving at all (unmatched route, inaccessible run).
      return new Response('', 204, $headers);
    }
    $encoding = $this->preferredEncoding($request);
    if ($encoding === NULL) {
      return new Response('', 406, $headers);
    }
    $download = [
      // text/plain plus nosniff is what keeps HTML inside a transcript inert:
      // the browser renders it as characters instead of executing it.
      'Content-Type' => 'text/plain; charset=utf-8',
      'Content-Disposition' => 'attachment',
    ];
    if ($encoding === 'identity') {
      return new Response($payload, 200, $headers + $download);
    }
    $encoded = gzencode($payload, 6);
    if ($encoded === FALSE) {
      return new Response('', 500, $headers);
    }
    return new Response($encoded, 200, $headers + $download + [
      'Content-Encoding' => 'gzip',
      'Content-Length' => (string) strlen($encoded),
    ]);
  }

  /**
   * Picks gzip or identity from Accept-Encoding, or NULL for 406.
   *
   * Absent header defaults to identity. Explicit gzip wins ties. Both
   * forbidden (`gzip;q=0` and `identity;q=0`, or `*;q=0`) is 406.
   */
  private function preferredEncoding(Request $request): ?string {
    if (!$request->headers->has('Accept-Encoding')) {
      return 'identity';
    }
    $header = AcceptHeader::fromString($request->headers->get('Accept-Encoding'));
    $gzip_q = $this->encodingQuality($header, 'gzip');
    $identity_q = $this->encodingQuality($header, 'identity');
    if ($gzip_q <= 0.0 && $identity_q <= 0.0) {
      return NULL;
    }
    return $gzip_q >= $identity_q ? 'gzip' : 'identity';
  }

  /**
   * Quality for one coding. Unmentioned identity stays allowed at q=1.
   */
  private function encodingQuality(AcceptHeader $header, string $coding): float {
    $item = $header->get($coding);
    if ($item !== NULL) {
      return $item->getQuality();
    }
    return $coding === 'identity' ? 1.0 : 0.0;
  }

}
