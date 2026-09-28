const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  API_VERSION,
  parseArgs,
  getDefaultDateRange,
  enumerateDays,
  nextCursor,
  createLogger,
  fetchReport,
  fetchUsageRecords,
  runExporter,
} = require('./get-copilot-usage-metrics');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-metrics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('parseArgs selects one target and applies a daily range', () => {
  const options = parseArgs([
    '--enterprise',
    'octo-enterprise',
    '--from',
    '2026-01-01',
    '--to',
    '2026-01-31',
    '--output',
    './result',
    '--concurrency',
    '3',
  ]);

  assert.equal(options.scope, 'enterprise');
  assert.equal(options.target, 'octo-enterprise');
  assert.equal(options.from, '2026-01-01');
  assert.equal(options.to, '2026-01-31');
  assert.equal(options.concurrency, 3);
  assert.equal(options.output, path.resolve('./result'));
});

test('parseArgs enables verbose logging via --verbose', () => {
  assert.equal(parseArgs(['--org', 'octo-org']).verbose, false);
  assert.equal(parseArgs(['--org', 'octo-org', '--verbose']).verbose, true);
});

test('createLogger only writes when enabled', () => {
  const lines = [];
  const disabled = createLogger(false, (line) => lines.push(line));
  const enabled = createLogger(true, (line) => lines.push(line));

  disabled('should not appear');
  enabled('should appear');

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[verbose\] .+ should appear$/);
});

test('parseArgs rejects conflicting targets and date options', () => {
  assert.throws(
    () => parseArgs(['--enterprise', 'e', '--org', 'o']),
    /exactly one/,
  );
  assert.throws(
    () => parseArgs(['--org', 'o', '--day', '2026-01-01', '--from', '2026-01-01', '--to', '2026-01-02']),
    /cannot be combined/,
  );
  assert.throws(
    () => parseArgs(['--org', 'o', '--day', '2026-02-30']),
    /valid calendar date/,
  );
});

test('default range uses the past 28 days ending yesterday', () => {
  assert.deepEqual(
    getDefaultDateRange(new Date('2026-09-22T08:30:00Z')),
    { from: '2026-08-25', to: '2026-09-21' },
  );
  assert.deepEqual(
    getDefaultDateRange(new Date('2025-10-12T08:30:00Z')),
    { from: '2025-10-10', to: '2025-10-11' },
  );
  assert.deepEqual(
    getDefaultDateRange(new Date('2027-09-22T08:30:00Z')),
    { from: '2027-08-25', to: '2027-09-21' },
  );
  assert.deepEqual(
    enumerateDays('2026-01-30', '2026-02-02'),
    ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'],
  );
});

test('nextCursor extracts the after parameter from a Link header', () => {
  assert.equal(
    nextCursor('<https://api.github.com/example?after=abc%2B123>; rel="next", <https://api.github.com/example?before=z>; rel="prev"'),
    'abc+123',
  );
  assert.equal(nextCursor(null), null);
});

test('fetchReport downloads all files and resumes completed daily reports', async (t) => {
  const root = await temporaryDirectory(t);
  let requestCount = 0;
  let downloadCount = 0;
  const octokit = {
    request: async (route, options) => {
      requestCount += 1;
      assert.equal(route, 'GET /orgs/octo-org/copilot/metrics/reports/users-1-day');
      assert.equal(options.day, '2026-01-03');
      assert.equal(options.headers['x-github-api-version'], API_VERSION);
      return {
        status: 200,
        headers: {},
        data: {
          report_day: '2026-01-03',
          download_links: ['https://download.test/one', 'https://download.test/two'],
        },
      };
    },
  };
  const fetchImpl = async () => {
    downloadCount += 1;
    return new Response(`{"part":${downloadCount}}\n`, { status: 200 });
  };
  const input = {
    octokit,
    fetchImpl,
    scope: 'organization',
    target: 'octo-org',
    family: 'users-1-day',
    endpoint: 'users-1-day',
    root,
    day: '2026-01-03',
    force: false,
    latest: false,
  };

  const first = await fetchReport(input);
  const resumed = await fetchReport(input);
  await fetchReport({ ...input, force: true });

  assert.equal(first.local_files.length, 2);
  assert.equal(resumed.skipped, true);
  assert.equal(requestCount, 2);
  assert.equal(downloadCount, 4);
});

test('fetchReport records a 204 response as an empty completed report', async (t) => {
  const root = await temporaryDirectory(t);
  const result = await fetchReport({
    octokit: {
      request: async () => ({ status: 204, headers: {}, data: undefined }),
    },
    fetchImpl: async () => {
      throw new Error('No download is expected');
    },
    scope: 'organization',
    target: 'octo-org',
    family: 'repos-1-day',
    endpoint: 'repos-1-day',
    root,
    day: '2026-01-03',
    force: false,
    latest: false,
  });

  assert.equal(result.empty, true);
  assert.deepEqual(result.local_files, []);
});

test('fetchUsageRecords follows after cursors and writes NDJSON', async (t) => {
  const root = await temporaryDirectory(t);
  const calls = [];
  const octokit = {
    request: async (route, options) => {
      calls.push({ route, options });
      assert.equal(options.headers['x-github-api-version'], API_VERSION);
      if (!options.after) {
        return {
          status: 200,
          headers: {
            link: '<https://api.github.com/enterprises/octo/copilot/usage-records?after=cursor-2>; rel="next"',
          },
          data: [{ event_id: 'one' }],
        };
      }
      return {
        status: 200,
        headers: {},
        data: [{ event_id: 'two' }],
      };
    },
  };

  const result = await fetchUsageRecords({
    octokit,
    root,
    target: 'octo',
    phrase: 'created:>=2026-01-01',
    runId: 'run',
  });
  const rows = (await fs.readFile(result.local_files[0], 'utf8')).trim().split('\n');

  assert.equal(result.pages, 2);
  assert.equal(result.rows, 2);
  assert.equal(calls[0].options.order, 'asc');
  assert.equal(calls[0].options.per_page, 25);
  assert.equal(calls[0].options.phrase, 'created:>=2026-01-01');
  assert.equal(calls[1].options.after, 'cursor-2');
  assert.deepEqual(rows.map(JSON.parse), [{ event_id: 'one' }, { event_id: 'two' }]);
});

test('runExporter covers all enterprise endpoint families and writes a complete manifest', async (t) => {
  const output = await temporaryDirectory(t);
  const routes = [];
  const octokit = {
    request: async (route, options) => {
      routes.push(route);
      if (route.endsWith('/usage-records')) {
        return {
          status: 200,
          headers: {},
          data: [{ event_id: 'event-1', type: 'request' }],
        };
      }
      const latest = route.endsWith('/latest');
      const family = route.split('/').at(-1) === 'latest'
        ? route.split('/').at(-2)
        : route.split('/').at(-1);
      return {
        status: 200,
        headers: {},
        data: {
          ...(latest
            ? { report_start_day: '2026-01-01', report_end_day: '2026-01-28' }
            : { report_day: options.day }),
          download_links: [`https://download.test/${family}`],
        },
      };
    },
  };
  const fetchImpl = async (url) => new Response(
    `${JSON.stringify({ source: new URL(url).pathname.slice(1), nested: { count: 1 } })}\n`,
    { status: 200 },
  );
  const options = parseArgs([
    '--enterprise',
    'octo-enterprise',
    '--day',
    '2026-01-28',
    '--output',
    output,
  ]);

  const { manifest, manifestPath } = await runExporter(options, {
    octokit,
    fetchImpl,
    now: new Date('2026-01-29T01:02:03Z'),
    finishedAt: new Date('2026-01-29T01:03:00Z'),
  });

  assert.equal(manifest.state, 'completed');
  assert.equal(manifest.failures.length, 0);
  assert.equal(manifest.completed.length, 7);
  assert.equal(routes.length, 7);
  for (const endpoint of [
    'enterprise-1-day',
    'repos-1-day',
    'user-teams-1-day',
    'users-1-day',
    'enterprise-28-day/latest',
    'users-28-day/latest',
    'usage-records',
  ]) {
    assert.ok(routes.some((route) => route.endsWith(`/${endpoint}`)), endpoint);
  }
  const savedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.equal(savedManifest.state, 'completed');
});

test('runExporter records a 404 on usage-records as unavailable, not a failure', async (t) => {
  const output = await temporaryDirectory(t);
  const octokit = {
    request: async (route, options) => {
      if (route.endsWith('/usage-records')) {
        const error = new Error('Not Found');
        error.status = 404;
        throw error;
      }
      const latest = route.endsWith('/latest');
      const family = route.split('/').at(-1) === 'latest'
        ? route.split('/').at(-2)
        : route.split('/').at(-1);
      return {
        status: 200,
        headers: {},
        data: {
          ...(latest
            ? { report_start_day: '2026-01-01', report_end_day: '2026-01-28' }
            : { report_day: options.day }),
          download_links: [`https://download.test/${family}`],
        },
      };
    },
  };
  const fetchImpl = async (url) => new Response(
    `${JSON.stringify({ source: new URL(url).pathname.slice(1), nested: { count: 1 } })}\n`,
    { status: 200 },
  );
  const options = parseArgs([
    '--enterprise',
    'octo-enterprise',
    '--day',
    '2026-01-28',
    '--output',
    output,
  ]);

  const { manifest } = await runExporter(options, {
    octokit,
    fetchImpl,
    now: new Date('2026-01-29T01:02:03Z'),
    finishedAt: new Date('2026-01-29T01:03:00Z'),
  });

  assert.equal(manifest.state, 'completed');
  assert.equal(manifest.failures.length, 0);
  assert.equal(manifest.unavailable.length, 1);
  assert.equal(manifest.unavailable[0].family, 'usage-records');
  assert.equal(manifest.unavailable[0].status, 404);
});

test('runExporter logs progress when verbose is enabled', async (t) => {
  const output = await temporaryDirectory(t);
  const octokit = {
    request: async (route, requestOptions) => ({
      status: 200,
      headers: {},
      data: {
        report_day: requestOptions.day,
        download_links: [`https://download.test/${route}`],
      },
    }),
  };
  const options = parseArgs([
    '--org',
    'octo-org',
    '--day',
    '2026-01-28',
    '--output',
    output,
    '--skip-latest',
    '--skip-usage-records',
    '--verbose',
  ]);
  const logLines = [];

  await runExporter(options, {
    octokit,
    fetchImpl: async () => new Response('{"count":1}\n', { status: 200 }),
    now: new Date('2026-01-29T01:02:03Z'),
    finishedAt: new Date('2026-01-29T01:03:00Z'),
    log: (message) => logLines.push(message),
  });

  assert.ok(logLines.some((line) => line.includes('daily reports: 4 task(s)')));
  assert.ok(logLines.some((line) => line.includes('latest reports: skipped')));
  assert.ok(logLines.some((line) => line.includes('usage records: skipped')));
});

test('runExporter marks API failures in the manifest', async (t) => {
  const output = await temporaryDirectory(t);
  const error = new Error('Internal Server Error');
  error.status = 500;
  error.response = { data: { message: 'failed' } };
  const options = parseArgs([
    '--org',
    'octo-org',
    '--day',
    '2026-01-28',
    '--output',
    output,
    '--skip-latest',
  ]);

  const { manifest } = await runExporter(options, {
    octokit: { request: async () => { throw error; } },
    fetchImpl: async () => {
      throw new Error('No download is expected');
    },
    now: new Date('2026-01-29T01:02:03Z'),
    finishedAt: new Date('2026-01-29T01:03:00Z'),
  });

  assert.equal(manifest.state, 'incomplete');
  assert.equal(manifest.failures.length, 4);
  assert.ok(manifest.failures.every((failure) => failure.status === 500));
});

test('runExporter covers all organization endpoint families', async (t) => {
  const output = await temporaryDirectory(t);
  const routes = [];
  const octokit = {
    request: async (route, options) => {
      routes.push(route);
      const latest = route.endsWith('/latest');
      return {
        status: 200,
        headers: {},
        data: {
          ...(latest
            ? { report_start_day: '2026-01-01', report_end_day: '2026-01-28' }
            : { report_day: options.day }),
          download_links: [`https://download.test/${routes.length}`],
        },
      };
    },
  };
  const options = parseArgs([
    '--org',
    'octo-org',
    '--day',
    '2026-01-28',
    '--output',
    output,
  ]);

  const { manifest } = await runExporter(options, {
    octokit,
    fetchImpl: async () => new Response('{"count":1}\n', { status: 200 }),
    now: new Date('2026-01-29T01:02:03Z'),
    finishedAt: new Date('2026-01-29T01:03:00Z'),
  });

  assert.equal(manifest.state, 'completed');
  assert.equal(routes.length, 6);
  for (const endpoint of [
    'organization-1-day',
    'repos-1-day',
    'user-teams-1-day',
    'users-1-day',
    'organization-28-day/latest',
    'users-28-day/latest',
  ]) {
    assert.ok(routes.some((route) => route.endsWith(`/${endpoint}`)), endpoint);
  }
});
