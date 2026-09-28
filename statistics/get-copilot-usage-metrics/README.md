# GitHub Copilot usage metrics exporter

Fetches raw GitHub Copilot usage metrics from the [REST API](https://docs.github.com/en/enterprise-cloud@latest/rest/copilot/copilot-usage-metrics). Exports daily and 28-day reports, plus enterprise usage records, without transformation.

## Setup

```bash
npm install
export GITHUB_TOKEN=your_token
```

## Usage

Enterprise (includes usage records):
```bash
node statistics/get-copilot-usage-metrics/get-copilot-usage-metrics.js --enterprise SLUG
```

Organization:
```bash
node statistics/get-copilot-usage-metrics/get-copilot-usage-metrics.js --org NAME
```

Date options (default: past 28 days ending yesterday):
```bash
--day 2026-09-01          # One day
--from 2026-08-01 --to 2026-08-31  # Date range
```

Other options:
```bash
--output <dir>            # Output directory (default: copilot-usage-metrics-exports)
--usage-phrase <phrase>   # Filter usage records (enterprise only)
--skip-latest             # Skip 28-day reports
--skip-usage-records      # Skip usage records (enterprise only)
--force                   # Re-fetch completed reports
--concurrency <1-10>      # Parallel requests (default: 4)
--verbose                 # Print detailed progress to stderr
```

## Output structure

```
copilot-usage-metrics-exports/
  enterprise|organization/TARGET/
    raw/
      daily/YYYY-MM-DD/REPORT_FAMILY/
      latest/REPORT_FAMILY/REPORT_RANGE/
      usage-records/RUN_ID/
    manifests/
    manifest-latest.json
    result.json
```

Each report directory contains only:
- `report-NNN.ndjson` — Downloaded data shards

`result.json` at the target root tracks completion for every daily report, latest report, and usage-records run, keyed by family/day. It is read and updated on each fetch rather than written per report directory.

## Behavior

- **Resume**: Skips completed daily reports (marked in `result.json`). Use `--force` to re-fetch.
- **Latest reports**: Fetched on every run to detect new ranges.
- **Atomic writes**: Uses temporary files; interrupted downloads are not marked complete.
- **Empty reports**: GitHub returns `204 No Content` for missing data; recorded as empty, not failed.
- **Usage records availability**: The usage-records endpoint returns `404 Not Found` for non-EMU enterprises. This is recorded as unavailable, not failed, and does not affect the exit code.
- **Manifest**: Tracks completed artifacts, empty reports, unavailable endpoints, and failures. Exit code 1 if incomplete (failures only).
- **Verbose logging**: With `--verbose`, prints timestamped progress (requests, downloads, skips, pagination) to stderr; stdout summary output is unchanged.

## Requirements

- Node.js 18+
- GitHub Enterprise Cloud account
- `GITHUB_TOKEN` environment variable

Token permissions:
- Enterprise reports: Owner, billing manager, or fine-grained `View Enterprise Copilot Metrics`
- Organization reports: Owner or fine-grained `View Organization Copilot Metrics`
- Usage records: EMU (GHEC and GHEC with Data Residency) enterprise owner only (public preview; optional with `--skip-usage-records`). Requests a 404 for non-EMU enterprises and is recorded as unavailable rather than a failure.

## Testing

```bash
npm test
```
