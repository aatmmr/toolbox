#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { once } = require('events');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { Octokit } = require('octokit');
require('dotenv').config();
const API_VERSION = '2026-03-10';
const EARLIEST_REPORT_DAY = '2025-10-10';
const DEFAULT_OUTPUT = 'copilot-usage-metrics-exports';
const DAILY_FAMILIES = {
  enterprise: [
    ['enterprise-1-day', 'enterprise-1-day'],
    ['repos-1-day', 'repos-1-day'],
    ['user-teams-1-day', 'user-teams-1-day'],
    ['users-1-day', 'users-1-day'],
  ],
  organization: [
    ['organization-1-day', 'organization-1-day'],
    ['repos-1-day', 'repos-1-day'],
    ['user-teams-1-day', 'user-teams-1-day'],
    ['users-1-day', 'users-1-day'],
  ],
};
const LATEST_FAMILIES = {
  enterprise: [
    ['enterprise-28-day', 'enterprise-28-day/latest'],
    ['users-28-day', 'users-28-day/latest'],
  ],
  organization: [
    ['organization-28-day', 'organization-28-day/latest'],
    ['users-28-day', 'users-28-day/latest'],
  ],
};

function usage() {
  return `
GitHub Copilot usage metrics exporter

Usage:
  node statistics/get-copilot-usage-metrics/get-copilot-usage-metrics.js \\
    (--enterprise <slug> | --org <name>) [options]

Target:
  --enterprise <slug>       Fetch enterprise reports and usage records
  --org <name>              Fetch organization reports

Date selection:
  --day <YYYY-MM-DD>        Fetch one daily report date
  --from <YYYY-MM-DD>       First day in an inclusive range
  --to <YYYY-MM-DD>         Last day in an inclusive range

Options:
  --output <directory>      Output directory (default: ${DEFAULT_OUTPUT})
  --usage-phrase <phrase>   Filter enterprise usage records
  --skip-latest             Do not fetch the latest 28-day reports
  --skip-usage-records      Do not fetch enterprise usage records
  --force                   Replace completed daily report artifacts
  --concurrency <number>    Concurrent report requests from 1 to 10 (default: 4)
  --verbose                 Print detailed progress to stderr
  --help, -h                Show this help

By default, the exporter fetches the past 28 days of daily history, the latest
28-day reports, and enterprise usage records.
`.trim();
}
function parseArgs(argv, now = new Date()) {
  const options = {
    output: DEFAULT_OUTPUT,
    skipLatest: false,
    skipUsageRecords: false,
    force: false,
    concurrency: 4,
    verbose: false,
  };
  const valueOptions = new Set([
    '--enterprise',
    '--org',
    '--day',
    '--from',
    '--to',
    '--output',
    '--usage-phrase',
    '--concurrency',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--skip-latest') {
      options.skipLatest = true;
      continue;
    }
    if (argument === '--skip-usage-records') {
      options.skipUsageRecords = true;
      continue;
    }
    if (argument === '--force') {
      options.force = true;
      continue;
    }
    if (argument === '--verbose') {
      options.verbose = true;
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    index += 1;
    const key = {
      '--enterprise': 'enterprise',
      '--org': 'org',
      '--day': 'day',
      '--from': 'from',
      '--to': 'to',
      '--output': 'output',
      '--usage-phrase': 'usagePhrase',
      '--concurrency': 'concurrency',
    }[argument];
    options[key] = value;
  }

  if (options.help) {
    return options;
  }
  if (Boolean(options.enterprise) === Boolean(options.org)) {
    throw new Error('Specify exactly one of --enterprise or --org');
  }
  if (options.day && (options.from || options.to)) {
    throw new Error('--day cannot be combined with --from or --to');
  }
  if ((options.from && !options.to) || (!options.from && options.to)) {
    throw new Error('--from and --to must be used together');
  }
  if (options.usagePhrase && options.org) {
    throw new Error('--usage-phrase is available only with --enterprise');
  }

  options.concurrency = Number(options.concurrency);
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 10) {
    throw new Error('--concurrency must be an integer from 1 to 10');
  }

  const defaultRange = getDefaultDateRange(now);
  const from = options.day || options.from || defaultRange.from;
  const to = options.day || options.to || defaultRange.to;
  validateIsoDay(from, '--day/--from');
  validateIsoDay(to, '--day/--to');
  if (from > to) {
    throw new Error('The start date must not be after the end date');
  }

  options.scope = options.enterprise ? 'enterprise' : 'organization';
  options.target = options.enterprise || options.org;
  options.from = from;
  options.to = to;
  options.output = path.resolve(options.output);
  return options;
}

function validateIsoDay(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
}

function formatUtcDay(date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultDateRange(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  const calculatedStart = formatUtcDay(start);
  const effectiveStart = calculatedStart > EARLIEST_REPORT_DAY ? calculatedStart : EARLIEST_REPORT_DAY;
  return {
    from: effectiveStart,
    to: formatUtcDay(end),
  };
}

function enumerateDays(from, to) {
  const days = [];
  const current = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (current <= end) {
    days.push(formatUtcDay(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function createLogger(enabled, output = console.error) {
  return (message) => {
    if (enabled) {
      output(`[verbose] ${new Date().toISOString()} ${message}`);
    }
  };
}

function createOctokit(token, fetchImpl = globalThis.fetch) {
  return new Octokit({
    auth: token,
    request: { fetch: fetchImpl },
  });
}

function apiHeaders() {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': API_VERSION,
  };
}

function entityBasePath(scope, target) {
  return scope === 'enterprise'
    ? `/enterprises/${encodeURIComponent(target)}/copilot/metrics/reports`
    : `/orgs/${encodeURIComponent(target)}/copilot/metrics/reports`;
}

function safeTargetName(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function tempPath(filePath) {
  return `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
}
async function atomicWrite(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = tempPath(filePath);
  try {
    await fsp.writeFile(temporary, content);
    await fsp.rename(temporary, filePath);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function downloadFile(url, filePath, fetchImpl = globalThis.fetch) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = tempPath(filePath);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/x-ndjson, application/json' },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
    }
    if (!response.body) {
      throw new Error(`Download returned no body for ${url}`);
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: 'wx' }));
    await fsp.rename(temporary, filePath);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

const resultLocks = new Map();

function queueResultUpdate(resultPath, updater) {
  const previous = resultLocks.get(resultPath) || Promise.resolve();
  const next = previous.then(updater, updater);
  resultLocks.set(resultPath, next.then(() => {}, () => {}));
  return next;
}

async function readResultEntries(resultPath) {
  if (!(await pathExists(resultPath))) {
    return {};
  }
  const state = JSON.parse(await fsp.readFile(resultPath, 'utf8'));
  return state.entries || {};
}

async function writeResultEntry(resultPath, key, entry) {
  return queueResultUpdate(resultPath, async () => {
    const entries = await readResultEntries(resultPath);
    entries[key] = entry;
    await atomicWriteJson(resultPath, { entries });
    return entry;
  });
}

async function readCompletedEntry(resultPath, key) {
  const entries = await readResultEntries(resultPath);
  const entry = entries[key];
  if (!entry || entry.state !== 'completed') {
    return null;
  }
  const files = entry.local_files || [];
  for (const filePath of files) {
    if (!(await pathExists(filePath))) {
      return null;
    }
  }
  return entry;
}

async function fetchReport({
  octokit,
  fetchImpl,
  scope,
  target,
  family,
  endpoint,
  root,
  day,
  force,
  latest,
  log = () => {},
}) {
  const basePath = entityBasePath(scope, target);
  const knownDirectory = latest
    ? null
    : path.join(root, 'raw', 'daily', day, family);
  const resultPath = path.join(root, 'result.json');
  const dailyKey = latest ? null : `daily/${family}/${day}`;

  if (!latest && !force) {
    const completed = await readCompletedEntry(resultPath, dailyKey);
    if (completed) {
      log(`skip ${family} ${day}: already completed at ${knownDirectory}`);
      return { ...completed, skipped: true };
    }
  }

  const requestOptions = {
    headers: apiHeaders(),
  };
  if (day) {
    requestOptions.day = day;
  }
  log(`request GET ${basePath}/${endpoint}${day ? ` day=${day}` : ''}`);
  const response = await octokit.request(`GET ${basePath}/${endpoint}`, requestOptions);
  log(`response ${family}${day ? ` ${day}` : ''}: status ${response.status}`);
  const responseData = response.data || {};
  const reportKey = responseData.report_day
    || [responseData.report_start_day, responseData.report_end_day].filter(Boolean).join('_')
    || (latest ? 'latest' : day);
  const directory = latest
    ? path.join(root, 'raw', 'latest', family, reportKey)
    : knownDirectory;
  const resultKey = latest ? `latest/${family}` : dailyKey;

  if (latest && !force) {
    const completed = await readCompletedEntry(resultPath, resultKey);
    if (completed && completed.report_key === reportKey) {
      log(`skip ${family} ${reportKey}: already completed at ${directory}`);
      return { ...completed, skipped: true };
    }
  }

  const downloadLinks = Array.isArray(responseData.download_links)
    ? responseData.download_links
    : [];
  log(`${family}${day ? ` ${day}` : ''}: ${downloadLinks.length} download link(s)`);
  const localFiles = [];
  for (let index = 0; index < downloadLinks.length; index += 1) {
    const filePath = path.resolve(directory, `report-${String(index + 1).padStart(3, '0')}.ndjson`);
    log(`downloading ${downloadLinks[index]} -> ${filePath}`);
    await downloadFile(downloadLinks[index], filePath, fetchImpl);
    localFiles.push(filePath);
  }
  const result = {
    state: 'completed',
    scope,
    target,
    family,
    day: responseData.report_day || day || null,
    report_start_day: responseData.report_start_day || null,
    report_end_day: responseData.report_end_day || null,
    report_key: latest ? reportKey : undefined,
    empty: response.status === 204 || downloadLinks.length === 0,
    local_files: localFiles,
  };
  await writeResultEntry(resultPath, resultKey, result);
  return result;
}

function nextCursor(linkHeader) {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return new URL(match[1]).searchParams.get('after');
    }
  }
  return null;
}

async function fetchUsageRecords({ octokit, root, target, phrase, runId, log = () => {} }) {
  const directory = path.join(root, 'raw', 'usage-records', runId);
  const recordsPath = path.resolve(directory, 'records.ndjson');
  const temporary = tempPath(recordsPath);
  await fsp.mkdir(directory, { recursive: true });
  const output = fs.createWriteStream(temporary, { flags: 'wx' });
  let after;
  let pageCount = 0;
  let rowCount = 0;

  try {
    do {
      log(`request usage-records page ${pageCount + 1}${after ? ` after=${after}` : ''}`);
      const response = await octokit.request(
        `GET /enterprises/${encodeURIComponent(target)}/copilot/usage-records`,
        {
          headers: apiHeaders(),
          per_page: 25,
          order: 'asc',
          ...(phrase ? { phrase } : {}),
          ...(after ? { after } : {}),
        },
      );
      pageCount += 1;
      const records = Array.isArray(response.data) ? response.data : [];
      log(`usage-records page ${pageCount}: ${records.length} row(s)`);
      for (const record of records) {
        if (!output.write(`${JSON.stringify(record)}\n`)) {
          await once(output, 'drain');
        }
        rowCount += 1;
      }
      after = nextCursor(response.headers.link);
    } while (after);
    output.end();
    await once(output, 'finish');
    await fsp.rename(temporary, recordsPath);
  } catch (error) {
    output.destroy();
    await fsp.rm(temporary, { force: true });
    throw error;
  }

  const result = {
    state: 'completed',
    scope: 'enterprise',
    target,
    family: 'usage-records',
    phrase: phrase || null,
    pages: pageCount,
    rows: rowCount,
    empty: rowCount === 0,
    local_files: [recordsPath],
  };
  await writeResultEntry(path.join(root, 'result.json'), `usage-records/${runId}`, result);
  return result;
}

function errorDetails(error, context) {
  return {
    ...context,
    status: error.status || null,
    message: error.message,
    response: error.response?.data || null,
  };
}

async function mapLimit(items, limit, mapper) {
  let nextIndex = 0;
  const results = new Array(items.length);
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function createRunId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

async function runExporter(options, dependencies = {}) {
  const token = dependencies.token || process.env.GITHUB_TOKEN;
  if (!token && !dependencies.octokit) {
    throw new Error('GITHUB_TOKEN is required');
  }
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const octokit = dependencies.octokit || createOctokit(token, fetchImpl);
  const now = dependencies.now || new Date();
  const runId = createRunId(now);
  const log = dependencies.log || createLogger(options.verbose);
  const root = path.join(options.output, options.scope, safeTargetName(options.target));
  log(`run ${runId}: root ${root}`);
  const manifest = {
    run_id: runId,
    state: 'running',
    api_version: API_VERSION,
    started_at: now.toISOString(),
    arguments: {
      scope: options.scope,
      target: options.target,
      from: options.from,
      to: options.to,
      output: options.output,
      skip_latest: options.skipLatest,
      skip_usage_records: options.skipUsageRecords,
      usage_phrase: options.usagePhrase || null,
      force: options.force,
      concurrency: options.concurrency,
      verbose: options.verbose,
    },
    completed: [],
    empty: [],
    unavailable: [],
    failures: [],
  };
  await fsp.mkdir(root, { recursive: true });

  const tasks = [];
  for (const day of enumerateDays(options.from, options.to)) {
    for (const [family, endpoint] of DAILY_FAMILIES[options.scope]) {
      tasks.push({ family, endpoint, day, latest: false });
    }
  }
  log(`daily reports: ${tasks.length} task(s) at concurrency ${options.concurrency}`);

  let stopForAuthorization = false;
  await mapLimit(tasks, options.concurrency, async (task) => {
    if (stopForAuthorization) {
      log(`skip ${task.family} ${task.day}: stopped after an authorization failure`);
      return null;
    }
    try {
      const result = await fetchReport({
        octokit,
        fetchImpl,
        scope: options.scope,
        target: options.target,
        root,
        force: options.force,
        log,
        ...task,
      });
      manifest.completed.push({
        family: task.family,
        day: task.day,
        skipped: Boolean(result.skipped),
        files: result.local_files,
      });
      if (result.empty) {
        manifest.empty.push({ family: task.family, day: task.day });
      }
      return result;
    } catch (error) {
      log(`failed ${task.family} ${task.day}: ${error.message}`);
      manifest.failures.push(errorDetails(error, {
        type: 'daily-report',
        family: task.family,
        day: task.day,
      }));
      if (error.status === 401 || error.status === 403) {
        stopForAuthorization = true;
      }
      return null;
    }
  });

  if (!options.skipLatest && !stopForAuthorization) {
    log(`latest reports: ${LATEST_FAMILIES[options.scope].length} task(s)`);
    for (const [family, endpoint] of LATEST_FAMILIES[options.scope]) {
      try {
        const result = await fetchReport({
          octokit,
          fetchImpl,
          scope: options.scope,
          target: options.target,
          family,
          endpoint,
          root,
          force: options.force,
          latest: true,
          log,
        });
        manifest.completed.push({
          family,
          report_start_day: result.report_start_day,
          report_end_day: result.report_end_day,
          skipped: Boolean(result.skipped),
          files: result.local_files,
        });
        if (result.empty) {
          manifest.empty.push({ family, report_end_day: result.report_end_day });
        }
      } catch (error) {
        log(`failed ${family} (latest): ${error.message}`);
        manifest.failures.push(errorDetails(error, { type: 'latest-report', family }));
        if (error.status === 401 || error.status === 403) {
          stopForAuthorization = true;
          break;
        }
      }
    }
  } else if (options.skipLatest) {
    log('latest reports: skipped by --skip-latest');
  }

  let usageResult = null;
  if (
    options.scope === 'enterprise'
    && !options.skipUsageRecords
    && !stopForAuthorization
  ) {
    log('usage records: starting fetch');
    try {
      usageResult = await fetchUsageRecords({
        octokit,
        root,
        target: options.target,
        phrase: options.usagePhrase,
        runId,
        log,
      });
      manifest.completed.push({
        family: 'usage-records',
        files: usageResult.local_files,
        rows: usageResult.rows,
      });
      if (usageResult.empty) {
        manifest.empty.push({ family: 'usage-records' });
      }
    } catch (error) {
      if (error.status === 404) {
        log('usage records: unavailable (404) - the enterprise is likely not an EMU enterprise');
        manifest.unavailable.push(errorDetails(error, {
          type: 'usage-records',
          family: 'usage-records',
          note: 'This endpoint is only available to EMU (GHEC and GHEC with Data Residency) enterprise owners.',
        }));
      } else {
        log(`failed usage-records: ${error.message}`);
        manifest.failures.push(errorDetails(error, {
          type: 'usage-records',
          family: 'usage-records',
          note: 'This public-preview endpoint requires an EMU enterprise owner.',
        }));
      }
    }
  } else if (options.skipUsageRecords) {
    log('usage records: skipped by --skip-usage-records');
  }

  manifest.state = manifest.failures.length === 0 ? 'completed' : 'incomplete';
  manifest.finished_at = (dependencies.finishedAt || new Date()).toISOString();
  const manifestPath = path.join(root, 'manifests', `${runId}.json`);
  log(`writing manifest to ${manifestPath}`);
  await atomicWriteJson(manifestPath, manifest);
  await atomicWriteJson(path.join(root, 'manifest-latest.json'), manifest);
  return { manifest, manifestPath };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}\n`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  console.log(`Fetching Copilot metrics for ${options.scope} ${options.target}`);
  console.log(`Daily range: ${options.from} through ${options.to}`);
  console.log(`Output: ${options.output}`);
  if (options.verbose) {
    console.log('Verbose logging enabled');
  }

  try {
    const { manifest, manifestPath } = await runExporter(options);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Completed artifacts: ${manifest.completed.length}`);
    if (manifest.unavailable.length > 0) {
      for (const entry of manifest.unavailable) {
        console.log(`Note: ${entry.type} ${entry.family || ''} is unavailable: ${entry.note}`);
      }
    }
    if (manifest.failures.length > 0) {
      console.error(`The run is incomplete. Failures: ${manifest.failures.length}`);
      for (const failure of manifest.failures) {
        console.error(
          `- ${failure.type} ${failure.family || ''} ${failure.day || ''}: `
          + `${failure.status || 'error'} ${failure.message}`,
        );
      }
      process.exitCode = 1;
    } else {
      console.log('The export completed successfully.');
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  API_VERSION,
  EARLIEST_REPORT_DAY,
  DAILY_FAMILIES,
  LATEST_FAMILIES,
  parseArgs,
  validateIsoDay,
  getDefaultDateRange,
  enumerateDays,
  entityBasePath,
  nextCursor,
  createLogger,
  fetchReport,
  fetchUsageRecords,
  runExporter,
  usage,
};

if (require.main === module) {
  main();
}
