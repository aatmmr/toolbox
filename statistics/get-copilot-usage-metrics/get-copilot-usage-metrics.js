#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
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

function serializeResponse(response) {
  return {
    status: response.status,
    headers: response.headers,
    data: response.data,
  };
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

async function readCompletedResult(resultPath) {
  if (!(await pathExists(resultPath))) {
    return null;
  }
  const result = JSON.parse(await fsp.readFile(resultPath, 'utf8'));
  if (result.state !== 'completed') {
    return null;
  }
  const files = result.local_files || [];
  for (const filePath of files) {
    if (!(await pathExists(filePath))) {
      return null;
    }
  }
  return result;
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
}) {
  const basePath = entityBasePath(scope, target);
  const knownDirectory = latest
    ? null
    : path.join(root, 'raw', 'daily', day, family);

  if (!latest && !force) {
    const completed = await readCompletedResult(path.join(knownDirectory, 'result.json'));
    if (completed) {
      return { ...completed, skipped: true };
    }
  }

  const requestOptions = {
    headers: apiHeaders(),
  };
  if (day) {
    requestOptions.day = day;
  }
  const response = await octokit.request(`GET ${basePath}/${endpoint}`, requestOptions);
  const responseData = response.data || {};
  const reportKey = responseData.report_day
    || [responseData.report_start_day, responseData.report_end_day].filter(Boolean).join('_')
    || (latest ? 'latest' : day);
  const directory = latest
    ? path.join(root, 'raw', 'latest', family, reportKey)
    : knownDirectory;
  const resultPath = path.join(directory, 'result.json');

  if (latest && !force) {
    const completed = await readCompletedResult(resultPath);
    if (completed) {
      return { ...completed, skipped: true };
    }
  }

  await atomicWriteJson(path.join(directory, 'api-response.json'), serializeResponse(response));
  const downloadLinks = Array.isArray(responseData.download_links)
    ? responseData.download_links
    : [];
  const localFiles = [];
  for (let index = 0; index < downloadLinks.length; index += 1) {
    const filePath = path.resolve(directory, `report-${String(index + 1).padStart(3, '0')}.ndjson`);
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
    empty: response.status === 204 || downloadLinks.length === 0,
    local_files: localFiles,
  };
  await atomicWriteJson(resultPath, result);
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

async function fetchUsageRecords({ octokit, root, target, phrase, runId }) {
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
  await atomicWriteJson(path.join(directory, 'result.json'), result);
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

async function* reportRows(filePath) {
  const handle = await fsp.open(filePath, 'r');
  const prefix = Buffer.alloc(64);
  const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
  await handle.close();
  const firstCharacter = prefix.subarray(0, bytesRead).toString('utf8').trimStart()[0];

  if (firstCharacter === '[') {
    const value = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    if (!Array.isArray(value)) {
      throw new Error(`Expected a JSON array in ${filePath}`);
    }
    for (const row of value) {
      yield row;
    }
    return;
  }

  const input = fs.createReadStream(filePath);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }
    try {
      yield JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid NDJSON in ${filePath} at line ${lineNumber}: ${error.message}`);
    }
  }
}

async function writeJson(filePath, inputFiles) {
  let rowCount = 0;
  const temporary = tempPath(filePath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const output = fs.createWriteStream(temporary, { flags: 'wx' });
  try {
    output.write('[\n');
    let firstRow = true;
    for (const inputFile of inputFiles) {
      for await (const row of reportRows(inputFile)) {
        const prefix = firstRow ? '' : ',\n';
        firstRow = false;
        rowCount += 1;
        if (!output.write(`${prefix}${JSON.stringify(row)}`)) {
          await once(output, 'drain');
        }
      }
    }
    output.write('\n]\n');
    output.end();
    await once(output, 'finish');
    await fsp.rename(temporary, filePath);
    return { file: path.resolve(filePath), rows: rowCount };
  } catch (error) {
    output.destroy();
    await fsp.rm(temporary, { force: true });
    throw error;
  }
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
  const root = path.join(options.output, options.scope, safeTargetName(options.target));
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
    },
    completed: [],
    empty: [],
    failures: [],
    json: [],
  };
  await fsp.mkdir(root, { recursive: true });

  const tasks = [];
  for (const day of enumerateDays(options.from, options.to)) {
    for (const [family, endpoint] of DAILY_FAMILIES[options.scope]) {
      tasks.push({ family, endpoint, day, latest: false });
    }
  }

  let stopForAuthorization = false;
  const reportResults = await mapLimit(tasks, options.concurrency, async (task) => {
    if (stopForAuthorization) {
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
        });
        reportResults.push(result);
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
        manifest.failures.push(errorDetails(error, { type: 'latest-report', family }));
        if (error.status === 401 || error.status === 403) {
          stopForAuthorization = true;
          break;
        }
      }
    }
  }

  let usageResult = null;
  if (
    options.scope === 'enterprise'
    && !options.skipUsageRecords
    && !stopForAuthorization
  ) {
    try {
      usageResult = await fetchUsageRecords({
        octokit,
        root,
        target: options.target,
        phrase: options.usagePhrase,
        runId,
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
      manifest.failures.push(errorDetails(error, {
        type: 'usage-records',
        family: 'usage-records',
        note: 'This public-preview endpoint requires an EMU enterprise owner.',
      }));
    }
  }

  const filesByFamily = new Map();
  for (const result of reportResults.filter(Boolean)) {
    if (!filesByFamily.has(result.family)) {
      filesByFamily.set(result.family, []);
    }
    filesByFamily.get(result.family).push(...result.local_files);
  }
  if (usageResult) {
    filesByFamily.set('usage-records', usageResult.local_files);
  }

  for (const [family, inputFiles] of filesByFamily) {
    if (inputFiles.length === 0) {
      continue;
    }
    const range = family.endsWith('28-day') || family === 'usage-records'
      ? runId
      : `${options.from}_${options.to}`;
    const jsonPath = path.join(root, 'json', `${family}_${range}.json`);
    try {
      manifest.json.push(await writeJson(jsonPath, inputFiles));
    } catch (error) {
      manifest.failures.push(errorDetails(error, {
        type: 'json',
        family,
        input_files: inputFiles,
      }));
    }
  }

  manifest.state = manifest.failures.length === 0 ? 'completed' : 'incomplete';
  manifest.finished_at = (dependencies.finishedAt || new Date()).toISOString();
  const manifestPath = path.join(root, 'manifests', `${runId}.json`);
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

  try {
    const { manifest, manifestPath } = await runExporter(options);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Completed artifacts: ${manifest.completed.length}`);
    console.log(`JSON files: ${manifest.json.length}`);
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
  reportRows,
  writeJson,
  fetchReport,
  fetchUsageRecords,
  runExporter,
  usage,
};

if (require.main === module) {
  main();
}
