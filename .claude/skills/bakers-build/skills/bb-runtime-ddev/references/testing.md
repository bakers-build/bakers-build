# Testing in DDEV

Read before running or writing any test in a DDEV project.

## PHPUnit selection

List and run the affected classes by explicit path, never `--filter` or `--group`: these can
report `No tests executed!` with exit 0. An empty discovery is a failed selection, not PASS. Use
discovery output for counts.

```bash
ddev exec ./vendor/bin/phpunit --configuration=phpunit.xml <path/to/AffectedTest.php> …
```

A full local run uses ParaTest with **four workers** and one path or suite (never a path list):

```bash
ddev exec ./vendor/bin/paratest --configuration=phpunit.xml --testsuite <suite> --processes 4
```

## sqlite versus MariaDB

PHPUnit uses sqlite `:memory:` by default. Production uses MariaDB, so a MariaDB-dependent defect
can pass here: assert on values, not on the database's formatting (e.g. decimal scale `'0.8'` vs
`'0.8000'`). A check that needs MariaDB (every Functional test) sets it **inside the container**;
exporting it on the host silently keeps sqlite:

```bash
ddev exec bash -c 'SIMPLETEST_DB=mysql://db:db@db/db ./vendor/bin/phpunit --configuration=phpunit.xml <path>'
```
