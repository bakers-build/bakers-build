<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Unit;

use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Render\RendererInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\Plugin\Island\PageContent;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Tests that the page content island adds no frame of its own.
 *
 * A full page load hands the island pre-rendered #markup, an island
 * navigation hands it a render array. Framing a form is the job of
 * EntityFormSurfaceSubscriber, which sees the live form on both paths; a
 * second guess here from markup mistook a View's exposed filter for a form.
 */
#[Group('island')]
final class PageContentTest extends UnitTestCase {

  /**
   * Builds the island around the given controller result.
   */
  private function build(array $content): array {
    $island = new PageContent(
      [],
      'page_content',
      [],
      $this->createMock(EntityTypeManagerInterface::class),
      $this->createMock(RendererInterface::class),
      $this->createMock(FormBuilderInterface::class),
      $this->createMock(IslandPluginManagerInterface::class),
      $this->createMock(LoggerInterface::class),
      $this->createMock(CsrfTokenGenerator::class),
      new RequestStack(),
    );
    return $island->build(['content' => $content]);
  }

  /**
   * Controller results of both render paths.
   */
  public static function content(): array {
    $view = '<div class="views-element-container"><form class="views-exposed-form" action="/bakers/projects"><input name="title"></form><table></table></div>';
    return [
      'view markup with an exposed filter form' => [['#markup' => $view]],
      'view render array' => [['#type' => 'view', '#name' => 'projects']],
      'form markup' => [['#markup' => '<form class="bakers-login-form" action="/user/login"></form>']],
      'form render array' => [['#type' => 'form', '#form_id' => 'user_pass']],
    ];
  }

  /**
   * The island renders the controller result as given.
   */
  #[DataProvider('content')]
  public function testContentIsRenderedAsGiven(array $content): void {
    $this->assertSame($content, $this->build($content));
  }

}
