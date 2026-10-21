<?php

declare(strict_types=1);

use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

$projectRoot = dirname(__DIR__);
$autoload = $projectRoot . '/vendor/autoload.php';
if (!is_file($autoload)) {
    fwrite(STDERR, "ERROR: vendor/autoload.php is missing; run composer install.\n");
    exit(1);
}
require $autoload;

if ($argc > 2) {
    fwrite(STDERR, "Usage: php scripts/check-config-sync.php [repository-root]\n");
    exit(1);
}

$root = realpath($argv[1] ?? $projectRoot);
if ($root === false || !is_dir($root)) {
    fwrite(STDERR, sprintf("ERROR: repository root does not exist: %s\n", $argv[1] ?? $projectRoot));
    exit(1);
}

/** @return list<string> */
function yamlFiles(string $directory): array
{
    if (!is_dir($directory)) {
        return [];
    }

    $files = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
    );
    foreach ($iterator as $file) {
        if ($file->isFile() && $file->getExtension() === 'yml') {
            $files[] = $file->getPathname();
        }
    }
    sort($files, SORT_STRING);
    return $files;
}

/** @return list<string> */
function sourceFiles(string $root): array
{
    // NOTE on the invariant this widening asserts: every scanned source object
    // must have a counterpart in `config/sync`. That is a bakers.build rule rather than
    // a Drupal one — Drupal's `config/optional` may legitimately stay
    // uninstalled — and it holds here because an entry missing from the sync
    // store is DELETED on import, so a bakers.build instance needs both copies. A
    // genuinely optional object added later would red this gate, and the answer
    // then is an exclusion with a reason, not a narrower glob.
    //
    // `config/optional` is scanned alongside `config/install`, and it is not
    // belt-and-braces. A recipe that installs a module takes only config named
    // `<module>.*` and skips `config/optional` entirely, so an object whose name
    // belongs to another provider — `system.menu.*`, `display_builder_*`,
    // `views.view.*` — can only reach the recipe path from `config/optional`
    // plus a `config: import:` entry. Every such object therefore lives there
    // and in `config/sync`, which is exactly the pair this script exists to
    // compare — and scanning `config/install` alone reported "N source config
    // file(s) agree" while saying nothing about any of them (BB-396 review).
    $directories = array_merge(
        glob($root . '/web/modules/custom/*/config/install', GLOB_ONLYDIR) ?: [],
        glob($root . '/web/modules/custom/*/config/optional', GLOB_ONLYDIR) ?: [],
        glob($root . '/recipes/*/config', GLOB_ONLYDIR) ?: [],
    );

    $files = [];
    foreach ($directories as $directory) {
        // The bb_e2e recipe is a test-only overlay. Its browser fixtures are
        // deliberately not part of the deployable config/sync export.
        if (str_ends_with($directory, '/recipes/bb_e2e/config')) {
            continue;
        }
        array_push($files, ...yamlFiles($directory));
    }
    sort($files, SORT_STRING);
    return $files;
}

function relativePath(string $root, string $path): string
{
    return str_replace(DIRECTORY_SEPARATOR, '/', substr($path, strlen($root) + 1));
}

function sourceRole(string $relative): string
{
    return str_starts_with($relative, 'recipes/') ? 'recipe source' : 'module source';
}

/** @param list<string|int> $segments */
function jsonPointer(array $segments): string
{
    return '/' . implode('/', array_map(
        static fn (string|int $segment): string => str_replace(
            ['~', '/'],
            ['~0', '~1'],
            (string) $segment,
        ),
        $segments,
    ));
}

function renderValue(mixed $value): string
{
    return json_encode(
        $value,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
}

/**
 * @param list<string|int> $segments
 * @param list<string> $errors
 */
function compareDeclared(
    mixed $source,
    mixed $export,
    array $segments,
    string $sourcePath,
    string $sourceRole,
    string $exportPath,
    array &$errors,
): void {
    // Config documents are known mappings at the root. Nested empty arrays stay
    // exact because Symfony YAML cannot retain whether they were {} or [].
    $sourceIsMapping = is_array($source)
        && ($segments === [] || ($source !== [] && !array_is_list($source)));
    if (!$sourceIsMapping) {
        if ($source !== $export) {
            $errors[] = sprintf(
                'ERROR: %s (%s) declares %s = %s; %s (export) declares %s',
                $sourcePath,
                $sourceRole,
                jsonPointer($segments),
                renderValue($source),
                $exportPath,
                renderValue($export),
            );
        }
        return;
    }

    if (!is_array($export) || ($export !== [] && array_is_list($export))) {
        $errors[] = sprintf(
            'ERROR: %s (%s) declares %s = %s; %s (export) declares %s',
            $sourcePath,
            $sourceRole,
            jsonPointer($segments),
            renderValue($source),
            $exportPath,
            renderValue($export),
        );
        return;
    }

    foreach ($source as $key => $sourceValue) {
        $keySegments = [...$segments, $key];
        if (!array_key_exists($key, $export)) {
            $errors[] = sprintf(
                'ERROR: %s (%s) declares %s = %s; %s (export) lacks that key',
                $sourcePath,
                $sourceRole,
                jsonPointer($keySegments),
                renderValue($sourceValue),
                $exportPath,
            );
            continue;
        }
        compareDeclared(
            $sourceValue,
            $export[$key],
            $keySegments,
            $sourcePath,
            $sourceRole,
            $exportPath,
            $errors,
        );
    }
}

$sources = sourceFiles($root);
$errors = [];

foreach ($sources as $sourceFile) {
    $sourcePath = relativePath($root, $sourceFile);
    $role = sourceRole($sourcePath);
    $configName = pathinfo($sourceFile, PATHINFO_FILENAME);
    $exportPath = 'config/sync/' . $configName . '.yml';
    $exportFile = $root . '/' . $exportPath;

    if (!is_file($exportFile)) {
        $errors[] = sprintf(
            'ERROR: %s (%s) declares configuration "%s"; config/sync (export) lacks %s',
            $sourcePath,
            $role,
            $configName,
            $exportPath,
        );
        continue;
    }

    try {
        $source = Yaml::parseFile($sourceFile);
        $export = Yaml::parseFile($exportFile);
    } catch (ParseException $exception) {
        $errors[] = sprintf(
            'ERROR: cannot parse %s or %s: %s',
            $sourcePath,
            $exportPath,
            $exception->getMessage(),
        );
        continue;
    }

    if (
        !is_array($source)
        || !is_array($export)
        || ($source !== [] && array_is_list($source))
        || ($export !== [] && array_is_list($export))
    ) {
        $errors[] = sprintf(
            'ERROR: %s and %s must both contain YAML mappings',
            $sourcePath,
            $exportPath,
        );
        continue;
    }

    unset($source['uuid'], $source['_core'], $export['uuid'], $export['_core']);
    compareDeclared($source, $export, [], $sourcePath, $role, $exportPath, $errors);
}

if ($errors !== []) {
    fwrite(STDERR, implode("\n", $errors) . "\n");
    fwrite(
        STDERR,
        sprintf("FAIL: %d config source/export mismatch(es).\n", count($errors)),
    );
    exit(1);
}

printf("OK: %d source config file(s) agree with config/sync.\n", count($sources));
