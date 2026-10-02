import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { createContentManifest } from './content-snapshot.mjs';
import { validateRequest, planContent, processContentRequest, finishPurge, checkOriginMarker, checkContentHealth, readJson } from './content-sync.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), D = 'd'.repeat(40);
const baseline = { commit: A, contentCommit: B, releaseId: 'release-a' };
const repo = 'owner/site';
const requestId = C + '-123-1';
const request = { version: 1, requestId, candidateCommit: C, repo, createdAt: '2026-10-02T00:00:00Z' };
const comparison = (base, candidate, override = {}) => ({ base, candidate, status: base === candidate ? 'identical' : 'ahead',
  files: base === candidate ? [] : [{ path: 'content/news/story.md', status: 'modified' }], totalCommits: 1, truncated: false, ...override });
const source = (override = {}) => ({ head: async () => C, compare: async (base, candidate) => comparison(base, candidate), ...override });

test('queue schema accepts only a bounded candidate request', () => {
  assert.deepEqual(validateRequest(request, requestId, repo), request);
  for (const malformed of [null, {}, { ...request, version: 2 }, { ...request, repo: 'evil/repo' },
    { ...request, command: 'restart all' }, { ...request, candidateCommit: D }, { ...request, createdAt: 'invalid' }]) {
    assert.throws(() => validateRequest(malformed, requestId, repo));
  }
  for (const id of ['../bad', C + '-1-1/evil', C + '-1-1.json', 'A'.repeat(40) + '-1-1']) assert.throws(() => validateRequest(request, id, repo));
});
test('stale commits do not need production or comparison', async () => {
  assert.equal((await planContent(source({ head: async () => D, compare: () => assert.fail('must not compare') }), null, C)).mode, 'stale');
});
test('missing paired content state requires first full publish', async () => {
  for (const value of [null, {}, { commit: A }, { commit: 'bad', contentCommit: B }]) assert.equal((await planContent(source(), value, C)).mode, 'full');
});
test('decision uses both deployed code and content ancestry', async () => {
  const calls = [];
  const mode = await planContent(source({ compare: async (base, candidate) => { calls.push(base); return comparison(base, candidate); } }), baseline, C);
  assert.equal(mode.mode, 'content'); assert.deepEqual(calls, [A, B]);
});
test('pending code change forces full publish even if candidate content is active', async () => {
  const changed = source({ compare: async (base, candidate) => comparison(base, candidate, { files: [{ path: 'lib/news/index.ts', status: 'modified' }] }) });
  assert.equal((await planContent(changed, { ...baseline, contentCommit: C }, C)).mode, 'full');
});
for (const status of ['behind', 'diverged']) test('refuses content rewind with ' + status + ' ancestry', async () => {
  assert.equal((await planContent(source({ compare: async (base, candidate) => comparison(base, candidate, base === B ? { status } : {}) }), baseline, C)).mode, 'full');
});
test('incomplete content ancestry requires full publish', async () => {
  assert.equal((await planContent(source({ compare: async (base, candidate) => comparison(base, candidate, { truncated: base === B }) }), baseline, C)).mode, 'full');
});
test('already active content is a noop only after code compatibility', async () => {
  assert.equal((await planContent(source(), { ...baseline, contentCommit: C }, C)).mode, 'noop');
});

function processor(overrides = {}) {
  const calls = [];
  const deps = { source: source(), request, ensureReady: async () => calls.push('ready'), loadBaseline: async () => baseline,
    assertOrigin: async () => calls.push('origin'), stage: async () => { calls.push('stage'); return 'prepared'; },
    activate: async (parent) => { assert.equal(parent, 'prepared'); calls.push('activate'); },
    purge: async () => { calls.push('purge'); return { status: 'success' }; }, ...overrides };
  return { calls, run: () => processContentRequest(deps) };
}
test('valid candidate stages before maintenance then purges', async () => {
  const p = processor(); const result = await p.run();
  assert.equal(result.status, 'success'); assert.equal(result.originUpdated, true);
  assert.deepEqual(p.calls, ['ready', 'origin', 'stage', 'origin', 'activate', 'purge']);
});
test('invalid content never stops the application', async () => {
  const p = processor({ stage: async () => { throw new Error('invalid candidate'); } });
  await assert.rejects(p.run, /invalid candidate/); assert.ok(!p.calls.includes('activate')); assert.ok(!p.calls.includes('purge'));
});
test('main advance during staging leaves production unchanged', async () => {
  let calls = 0; const p = processor({ source: source({ head: async () => ++calls === 1 ? C : D }) });
  assert.equal((await p.run()).mode, 'stale'); assert.ok(!p.calls.includes('activate'));
});
test('baseline drift after staging refuses activation', async () => {
  let calls = 0; const p = processor({ loadBaseline: async () => ++calls === 1 ? baseline : { ...baseline, contentCommit: D } });
  await assert.rejects(p.run, /baseline changed/); assert.ok(!p.calls.includes('activate'));
});
test('origin release mismatch refuses downloads and maintenance', async () => {
  const p = processor({ assertOrigin: async () => { throw new Error('marker mismatch'); } });
  await assert.rejects(p.run, /marker mismatch/); assert.ok(!p.calls.includes('stage'));
});
test('unfinished maintenance journal blocks even a cache retry', async () => {
  const p = processor({ ensureReady: async () => { throw new Error('unfinished journal'); } });
  await assert.rejects(p.run, /unfinished journal/); assert.equal(p.calls.length, 0);
});
test('activation failure never proceeds to cache purge', async () => {
  const p = processor({ activate: async () => { throw new Error('restored old content'); } });
  await assert.rejects(p.run, /restored/); assert.ok(!p.calls.includes('purge'));
});
test('purge failure truthfully reports active origin, with no repeated swap', async () => {
  const p = processor({ purge: async () => ({ status: 'pending', jobId: 'job-1' }) });
  const result = await p.run(); assert.equal(result.status, 'failed'); assert.equal(result.originUpdated, true);
  const retry = processor({ loadBaseline: async () => ({ ...baseline, contentCommit: C }) });
  assert.equal((await retry.run()).mode, 'noop'); assert.ok(!retry.calls.includes('stage')); assert.ok(!retry.calls.includes('activate')); assert.ok(retry.calls.includes('purge'));
});
test('code changes are forwarded to full build without content download', async () => {
  const p = processor({ source: source({ compare: async (base, candidate) => comparison(base, candidate, { files: [{ path: 'package.json', status: 'modified' }] }) }) });
  assert.equal((await p.run()).mode, 'full'); assert.ok(!p.calls.includes('stage'));
});

test('purge job is persisted before status polling', async () => {
  const events = [];
  const result = await finishPurge({ create: async () => { events.push('create'); return { jobId: 'job-1' }; },
    describe: async () => { events.push('describe'); return { jobId: 'job-1', statuses: ['success'], totalCount: 1 }; },
    save: async (value) => events.push('save:' + value.status) });
  assert.equal(result.status, 'success'); assert.deepEqual(events, ['create', 'save:pending', 'describe', 'save:success']);
});
test('pending purge reuses existing job and bounds polling', async () => {
  let polls = 0;
  const result = await finishPurge({ state: { status: 'pending', jobId: 'job-1' }, create: () => assert.fail('do not create twice'),
    describe: async () => { polls++; return { jobId: 'job-1', statuses: ['processing'], totalCount: 1 }; }, save: async () => {}, pause: async () => {}, attempts: 3 });
  assert.equal(polls, 3); assert.equal(result.status, 'pending'); assert.equal(result.jobId, 'job-1');
});
for (const status of ['failed', 'timeout', 'canceled']) test('terminal purge failure can submit a new job: ' + status, async () => {
  let creates = 0;
  const result = await finishPurge({ state: { status, jobId: 'old-job' }, create: async () => { creates++; return { jobId: 'new-job' }; },
    describe: async () => ({ jobId: 'new-job', statuses: ['success'], totalCount: 1 }), save: async () => {} });
  assert.equal(creates, 1); assert.equal(result.status, 'success');
});
test('purge does not certify a partial task page or empty response', async () => {
  for (const statuses of [[], ['success']]) {
    const result = await finishPurge({ state: { status: 'pending', jobId: 'job-1' }, describe: async () => ({ jobId: 'job-1', statuses, totalCount: 2 }),
      create: () => assert.fail('no create'), save: async () => {}, attempts: 1 });
    assert.equal(result.status, 'pending');
  }
});
test('provider failure retains known job and never exposes secrets', async () => {
  const result = await finishPurge({ state: { status: 'pending', jobId: 'job-1' }, describe: async () => { throw new Error('secret-token'); }, save: async () => {} });
  assert.equal(result.jobId, 'job-1'); assert.ok(!JSON.stringify(result).includes('secret-token'));
});
test('success state performs no external calls', async () => {
  const state = { status: 'success', jobId: 'job-1' };
  assert.equal(await finishPurge({ state, create: () => assert.fail(), describe: () => assert.fail(), save: () => assert.fail() }), state);
});

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'content-worker-test-'));
  t.after(async () => {
    const rel = relative(resolve(tmpdir()), resolve(parent));
    assert.ok(rel.startsWith('content-worker-test-') && !rel.includes(sep));
    await rm(parent, { recursive: true, force: true });
  });
  await mkdir(join(parent, 'content', 'news', 'images'), { recursive: true });
  await mkdir(join(parent, 'content', 'leaderboard'));
  await writeFile(join(parent, 'content', 'news', 'one.md'), '---\ntitle: One\nslug: one\ndate: "2026-10-02"\ncategory: 更新\ncover: /content/news/images/one.svg\n---\nArticle\n');
  await writeFile(join(parent, 'content', 'news', 'images', 'one.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(parent, 'content', 'leaderboard', 'index.yml'), 'entries:\n  - rank: 1\n    player: PlayerOne\n    score: 42\n');
  const manifest = await createContentManifest(join(parent, 'content'), C);
  await writeFile(join(parent, 'manifest.json'), JSON.stringify(manifest));
  return parent;
}
const origin = 'http://127.0.0.1:3000';
function healthFetch(overrides = {}) {
  const routes = { '/__release.json': JSON.stringify({ id: 'release-a', commit: A }), '/news': '<a href="/news/one">One</a><li>PlayerOne<span>42<!-- --> 胜</span></li>',
    '/news/one': '<h1>One</h1><p>Article</p>', '/content/news/images/one.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>', ...overrides };
  return async (url) => new Response(routes[new URL(url).pathname] ?? '', { status: Object.hasOwn(routes, new URL(url).pathname) ? 200 : 404 });
}
test('health validates origin code, slugs, detail, board and image bytes', async (t) => {
  const parent = await fixture(t);
  assert.deepEqual(await checkContentHealth({ config: { origin }, parent, codeCommit: A, releaseId: 'release-a', fetchImpl: healthFetch() }), { healthy: true, articleCount: 1 });
});
test('health compares rendered GFM text, not literal Markdown markers', async (t) => {
  const parent = await fixture(t);
  const article = join(parent, 'content', 'news', 'one.md');
  await writeFile(article, (await readFile(article, 'utf8')).replace('Article', '~~Changed paragraph~~'));
  await writeFile(join(parent, 'manifest.json'), JSON.stringify(await createContentManifest(join(parent, 'content'), C)));
  const result = await checkContentHealth({ config: { root: parent, origin }, parent, codeCommit: A, releaseId: 'release-a',
    fetchImpl: healthFetch({ '/news/one': '<h1>One</h1><p><del>Changed paragraph</del></p>' }) });
  assert.equal(result.healthy, true);
});
test('health refuses a live tree with different bytes before probing HTTP', async (t) => {
  const parent = await fixture(t);
  const live = await fixture(t);
  await writeFile(join(live, 'content', 'news', 'images', 'one.svg'), '<svg>wrong live data</svg>');
  await assert.rejects(() => checkContentHealth({ config: { root: live, origin }, parent, codeCommit: A,
    releaseId: 'release-a', fetchImpl: () => assert.fail('different live tree must fail first') }), /manifest/i);
});
for (const [name, overrides, error] of [
  ['empty news fallback', { '/news': 'PlayerOne' }, /slugs/],
  ['unexpected old article', { '/news': '<a href="/news/one">One</a><a href="/news/old">Old</a>PlayerOne' }, /slugs/],
  ['missing board', { '/news': '<a href="/news/one">One</a>' }, /leaderboard/],
  ['old score for same player', { '/news': '<a href="/news/one">One</a><li>PlayerOne<span>41 胜</span></li>' }, /leaderboard/],
  ['old text for same article', { '/news/one': '<h1>One</h1><p>Old body</p>' }, /article text/],
  ['different image bytes', { '/content/news/images/one.svg': '<svg>stale</svg>' }, /image/],
]) test('health rejects ' + name, async (t) => {
  const parent = await fixture(t);
  await assert.rejects(() => checkContentHealth({ config: { origin }, parent, codeCommit: A, releaseId: 'release-a', fetchImpl: healthFetch(overrides) }), error);
});
test('origin marker distinguishes code version from content commit', async () => {
  await checkOriginMarker(origin, baseline, healthFetch());
  await assert.rejects(() => checkOriginMarker(origin, { ...baseline, commit: C }, healthFetch()), /marker/);
});
test('JSON reader rejects oversized and malformed data', async (t) => {
  const parent = await fixture(t); const path = join(parent, 'bounded.json');
  await writeFile(path, '{"large":"123456789"}');
  await assert.rejects(() => readJson(path, { maxBytes: 4 }), /bounded/);
  await writeFile(path, '{broken'); await assert.rejects(() => readJson(path), SyntaxError);
  assert.equal(await readJson(join(parent, 'absent'), { optional: true, attempts: 1 }), null);
});
