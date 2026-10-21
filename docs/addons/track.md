# Time evidence

**Collects your runs, activities and booked time per day, to prepare time entries.**

For employees who prepare their time with the `prepare-time` skill.

## Enable it

Nothing to enable. The command ships with the bakers.build CLI as `bakers track evidence`. The server must provide the `bb_track` worklog endpoint.

## Options

No options. The command takes `--from`, `--to`, `--timezone`, `--config` and `--connection`.

## Check it works

The command prints JSON with `days`, `weeks`, `worklogs`, `tickets` and `projects`.

::: details Per CLI
```sh
bakers track evidence --from 2026-10-12 --to 2026-10-18
```
:::

## Good to know

- You can read only your own evidence.
- Dates are inclusive, at most 366 per call. Without a profile timezone, pass `--timezone`.
- `complete: false` and `evidence_gaps` show what is missing. A `null` count means unknown, not zero.
- It only reads. It never starts a timer or books time.

More: [Record time](/daily-work/record-time).

Source: [`bakers-cli/addons/track`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/track)
