<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbProject;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the bb_repo URL property accepts SSH URLs and rejects garbage.
 *
 * Covers BB-136: saving a project with an SSH repository URL must not fail
 * validation, while a genuinely malformed URL is rejected with a specific,
 * field-naming message.
 */
#[Group('bb_core')]
final class BbRepoUrlConstraintTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'og',
    'link', 'text', 'filter', 'field', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * Collects violation messages anchored under the repository field.
   *
   * The test project intentionally omits unrelated required fields (group_id,
   * key), so its full validation carries noise; only repo-URL violations are
   * germane to BB-136.
   *
   * @param string $url
   *   The repository URL to place on a fresh project and validate.
   *
   * @return array<int, string>
   *   Violation messages anchored under the `repository` field.
   */
  private function repoUrlViolations(string $url): array {
    $project = BbProject::create(['name' => 'p', 'repository' => [['url' => $url]]]);
    $messages = [];
    foreach ($project->validate() as $violation) {
      if (str_starts_with((string) $violation->getPropertyPath(), 'repository')) {
        $messages[] = (string) $violation->getMessage();
      }
    }
    return $messages;
  }

  /**
   * Accepted repository URL forms produce no validation violation.
   *
   * @param string $url
   *   A repository URL that must validate.
   */
  #[DataProvider('acceptedUrls')]
  public function testAcceptedUrls(string $url): void {
    $this->assertSame([], $this->repoUrlViolations($url), sprintf('URL %s should validate.', $url));
  }

  /**
   * Data provider: repository URLs that must be accepted.
   *
   * @return array<string, array{string}>
   *   Test cases keyed by a readable label.
   */
  public static function acceptedUrls(): array {
    return [
      'scp shorthand' => ['git@github.com:acme/widget.git'],
      'scp shorthand nested path' => ['git@gitlab.com:group/sub/widget.git'],
      'ssh scheme' => ['ssh://git@github.com/acme/widget.git'],
      'ssh scheme with port' => ['ssh://git@example.com:2222/acme/widget.git'],
      'https' => ['https://github.com/acme/widget.git'],
      'http' => ['http://example.com/acme/widget.git'],
      // Token-auth clone URLs carry userinfo — accepted by the old #type=>url
      // validator, so widening must not regress them (review verdict #2).
      'https with userinfo' => ['https://oauth2:TOKEN@github.com/acme/widget.git'],
      'https with user only' => ['https://user@github.com/acme/widget.git'],
      // Bracketed IPv6 literal host.
      'https ipv6 host' => ['https://[::1]/acme/widget.git'],
      'ssh ipv6 host with port' => ['ssh://git@[2001:db8::1]:2222/acme/widget.git'],
    ];
  }

  /**
   * A malformed URL is rejected with a specific, field-naming message.
   *
   * @param string $url
   *   A repository URL that must be rejected.
   */
  #[DataProvider('rejectedUrls')]
  public function testRejectedUrls(string $url): void {
    $messages = $this->repoUrlViolations($url);
    $this->assertNotEmpty($messages, sprintf('URL %s should be rejected.', $url));
    // AC-2: the message is specific — it names the offending value, not a
    // generic "save failed".
    $this->assertStringContainsString($url, implode("\n", $messages));
  }

  /**
   * Data provider: repository URLs that must be rejected.
   *
   * @return array<string, array{string}>
   *   Test cases keyed by a readable label.
   */
  public static function rejectedUrls(): array {
    return [
      'plain words' => ['not a url'],
      'bare word' => ['nonsense'],
      'scheme only' => ['ssh://'],
      'space in host' => ['git@ho st:acme/widget.git'],
      // A trailing newline must not slip past the anchor (PCRE `$` matches
      // before a final \n; regexes are anchored with \z to forbid it).
      'trailing newline scp' => ["git@github.com:acme/widget.git\n"],
      'trailing newline https' => ["https://github.com/acme/widget.git\n"],
    ];
  }

  /**
   * A default branch that git could read as an option is refused.
   */
  public function testRefusesInvalidDefaultBranch(): void {
    foreach (['--upload-pack=touch PWNED', '-x', 'a..b', 'a b'] as $branch) {
      $this->assertContains('repository.0.default_branch', $this->defaultBranchPaths($branch), sprintf('%s should be refused.', $branch));
    }
    $this->assertNotContains('repository.0.default_branch', $this->defaultBranchPaths('release/1.2'));
  }

  /**
   * The violation paths of a project whose repository has that default branch.
   *
   * @return list<string>
   *   Property paths of every violation.
   */
  private function defaultBranchPaths(string $branch): array {
    $project = BbProject::create([
      'name' => 'p',
      'repository' => [['url' => 'https://github.com/acme/widget.git', 'default_branch' => $branch]],
    ]);
    return array_map(fn ($v) => (string) $v->getPropertyPath(), iterator_to_array($project->validate(), FALSE));
  }

}
