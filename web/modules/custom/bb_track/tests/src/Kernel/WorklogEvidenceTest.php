<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_track\Controller\WorklogEvidenceController;
use Drupal\bb_track\Entity\Submission;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;

/**
 * Personal evidence never mixes another employee's time or records proposals.
 */
#[Group('bb_track')]
final class WorklogEvidenceTest extends WorkTimeTestBase {

  /**
   * Reads page through own recorded/proposed time without mutating it.
   */
  public function testPersonalPagination(): void {
    $input = $this->container->get('bb_track.activity_input');
    $own = $input->input($this->activity('own'));
    $submission = Submission::create(['state' => 'proposed']);
    $submission->save();
    $proposal = $input->input($this->activity('proposal') + ['submission_id' => (int) $submission->id()]);
    $this->container->get('current_user')->setAccount($this->peer);
    $foreign = $input->input($this->activity('peer'));
    $this->addMembership($this->project->get('teams')->entity, $this->employee, ['lead']);
    $this->container->get('current_user')->setAccount($this->employee);
    self::assertTrue($foreign->access('view', $this->employee));
    $controller = new WorklogEvidenceController();
    $request = Request::create('/api/time/worklogs', 'GET', [
      'from' => '2026-08-03',
      'to' => '2026-08-09',
      'page' => ['limit' => '1'],
    ]);
    $response = $controller->read($request);
    self::assertSame(200, $response->getStatusCode());
    self::assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    $first = json_decode((string) $response->getContent(), TRUE, 512, JSON_THROW_ON_ERROR);
    self::assertSame([$own->uuid()], array_column($first['data'], 'id'));
    self::assertNotNull($first['links']['next']);
    $request->query->set('page', ['limit' => '1', 'offset' => '1']);
    $second = json_decode((string) $controller->read($request)->getContent(), TRUE, 512, JSON_THROW_ON_ERROR);
    self::assertSame([$proposal->uuid()], array_column($second['data'], 'id'));
    self::assertSame('proposed', $second['data'][0]['attributes']['state']);
    self::assertNull($second['links']['next']);
    self::assertSame('proposed', Submission::load($submission->id())->get('state')->value);
  }

  /**
   * Invalid selection and anonymous reads cannot yield an apparent empty day.
   */
  public function testInvalidAndAnonymousReads(): void {
    $controller = new WorklogEvidenceController();
    foreach ([
      ['from' => '2026-02-30', 'to' => '2026-03-01'],
      ['from' => '2026-08-09', 'to' => '2026-08-03'],
      ['from' => '2026-08-03', 'to' => '2026-08-09', 'owner' => $this->peer->uuid()],
      ['from' => '2026-08-03', 'to' => '2026-08-09', 'page' => ['offset' => '-1']],
    ] as $query) {
      self::assertSame(400, $controller->read(Request::create('/api/time/worklogs', 'GET', $query))->getStatusCode());
    }
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    self::assertSame(403, $controller->read(Request::create('/api/time/worklogs'))->getStatusCode());
  }

}
