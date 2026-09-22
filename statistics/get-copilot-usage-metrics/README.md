# GitHub Copilot usage metrics exporter

This script fetches the data from the [GitHub Copilot usage metrics REST API](https://docs.github.com/en/enterprise-cloud@latest/rest/copilot/copilot-usage-metrics?apiVersion=2026-03-10). It supports enterprise and organization reports, raw NDJSON downloads, JSON summary files, and enterprise usage records.

## Data fetched

An enterprise run fetches:

- Daily enterprise, repository, user-team, and user reports
- Latest 28-day enterprise and user reports
- All pages from the public-preview enterprise usage-records endpoint

An organization run fetches:

- Daily organization, repository, user-team, and user reports
- Latest 28-day organization and user reports

By default, daily reports cover the most recent 28-day window ending yesterday in UTC. Use `--day` or `--from` with `--to` to fetch a different period.

## Requirements

- Node.js 18 or later
- A GitHub Enterprise Cloud account
- The enterprise **Copilot usage metrics** policy set to **Enabled everywhere**
- A token in `GITHUB_TOKEN`

Token access depends on the target:

| Target | Required access |
|---|---|
| Enterprise reports | Enterprise owner, billing manager, or fine-grained **View Enterprise Copilot Metrics** permission. Classic tokens need `manage_billing:copilot` or `read:enterprise`. |
| Enterprise usage records | EMU enterprise owner. Classic tokens need `read:enterprise`. |
| Organization reports | Organization owner or fine-grained **View Organization Copilot Metrics** permission. Classic tokens need `read:org`. |

The usage-records endpoint is in public preview. A non-EMU enterprise or a token without access makes the run incomplete. Use `--skip-usage-records` when this data is intentionally out of scope.

## Setup

Install the repository dependencies:

```bash
npm install
```

Set the token in the environment:

```bash
export GITHUB_TOKEN=your_token
```

You can also copy `.env.example` to the repository root as `.env`.

## Usage

Fetch the default enterprise data window (past 28 days):

```bash
node statistics/get-copilot-usage-metrics/get-copilot-usage-metrics.js \
  --enterprise ENTERPRISE_SLUG
```

Fetch the default organization data window (past 28 days):

```bash
node statistics/get-copilot-usage-metrics/get-copilot-usage-metrics.js \
  --org ORGANIZATION
```

Fetch one day:

```bash
node statistics/get-copilot-usage-metrics/get-copilot-usage-metrics.js \
  --org ORGANIZATION \
  --day 2026-09-01
```

Fetch an inclusive date range and omit the latest 28-day reports:

```bash
node statistics/get-copilot-usage-metrics/get-copilot-usage-metrics.js \
  --enterprise ENTERPRISE_SLUG \
  --from 2026-08-01 \
  --to 2026-08-31 \
  --skip-latest
```

Filter enterprise usage records with the API search syntax:

```bash
node statistics/get-copilot-usage-metrics/get-copilot-usage-metrics.js \
  --enterprise ENTERPRISE_SLUG \
  --usage-phrase "type:request created:>=2026-09-01"
```

Run `--help` for all options:

```text
--enterprise <slug>       Enterprise target
--org <name>              Organization target
--day <YYYY-MM-DD>        One daily report date
--from <YYYY-MM-DD>       First day in an inclusive range
--to <YYYY-MM-DD>         Last day in an inclusive range
--output <directory>      Output directory
--usage-phrase <phrase>   Enterprise usage-record filter
--skip-latest             Omit latest 28-day reports
--skip-usage-records      Omit enterprise usage records
--force                   Replace completed daily artifacts
--concurrency <1-10>      Concurrent report requests
--help                    Show help
```

## Output

The default output directory is `copilot-usage-metrics-exports/`. Data is grouped by scope and target:

```text
copilot-usage-metrics-exports/
  enterprise/ENTERPRISE_SLUG/
    raw/
      daily/YYYY-MM-DD/REPORT_FAMILY/
      latest/REPORT_FAMILY/REPORT_RANGE/
      usage-records/RUN_ID/
    json/
    manifests/
    manifest-latest.json
```

Each raw report directory contains:

- `api-response.json`: The REST response that supplied the signed download URLs
- `report-NNN.ndjson`: The downloaded report shards
- `result.json`: Local completion metadata

JSON files contain an array combining the selected reports by family. Rows retain their original nested objects and arrays, so language, feature, IDE, model, agent, and other variable breakdowns remain structured. Daily summaries use the selected date range in their file names; latest 28-day reports and usage records use a run ID.

The manifest records the arguments, completed and empty reports, failures, row counts, JSON file paths, and final state in its `json` array. A command exits with status 1 when the manifest is incomplete.

## Resume and refresh behavior

A repeated run skips a daily report when its `result.json` and all downloaded files are complete. `--force` requests and replaces those files. Latest reports are requested on every run so the script can identify a new report range. Usage records are stored under a new run ID because the event stream can grow.

Downloads use temporary files and an atomic rename. An interrupted file is not marked as complete.

## Data notes

- Signed report URLs expire, so the script downloads each report immediately.
- GitHub can return `204 No Content` for report families without data. The manifest records these reports as empty, not failed.
- User reports contain identifiable usage data. Protect the output directory and apply your organization's retention requirements.
- Teams with fewer than five seated Copilot users are omitted from user-team reports by GitHub.
- Daily user and user-team files can be joined on `user_id`, `day`, and `enterprise_id` or `organization_id`. The exporter preserves these source files but does not derive team totals.
- A user who belongs to multiple teams contributes to each team. Do not sum derived team totals to calculate an enterprise or organization total.
- The script uses REST API version `2026-03-10`.

## Tests

Run the focused tests:

```bash
npm test
```
