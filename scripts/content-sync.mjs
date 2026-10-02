// Installed, administrator-owned tool. Candidates contribute data only.
// See deploy/CONTENT-SYNC.md for the queue, maintenance and recovery protocol.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, appendFile, lstat, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { slugify } from '../lib/slugify-core.mjs';
import { GitHubContentSource, decideContentUpdate } from './content-source.mjs';
import { createContentManifest, validateContent, verifyContentManifest } from './content-snapshot.mjs';

const execute = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
const REQUEST_ID = /^([a-f0-9]{40})-([0-9]{1,20})-([0-9]{1,6})$/;
const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const timestamp = () => new Date().toISOString();
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function requireSha(v) { if (!SHA.test(v ?? '')) throw new Error('A full lowercase commit SHA is required'); return v; }
function within(root, path) {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Path must remain within the configured directory');
  return resolve(path);
}
async function noLinks(path) {
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(cursor) === cursor) return;
  }
}
// Readers outside the administrator lock may briefly encounter a replace window.
export async function readJson(path, { optional = false, maxBytes = 2 * 1024 * 1024, attempts = 5 } = {}) {
  for (let n = 0; n < attempts; n++) {
    try {
      await noLinks(path);
      const st = await lstat(path);
      if (!st.isFile() || st.size > maxBytes) throw new Error('JSON file is not an ordinary bounded file');
      const bytes = await readFile(path);
      if (bytes.length > maxBytes) throw new Error('JSON file exceeds the size limit');
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''));
    } catch (error) {
      if (!['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      if (n === attempts - 1) { if (optional && error.code === 'ENOENT') return null; throw error; }
      await sleep(100);
    }
  }
}
async function writeJson(path, value, { exclusive = false } = {}) {
  await noLinks(path);
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) { await writeFile(path, bytes, { flag: 'wx' }); return; }
  const temporary = join(dirname(path), '.content-' + randomUUID() + '.tmp');
  await writeFile(temporary, bytes, { flag: 'wx' });
  for (let n = 0; ; n++) {
    try { await rename(temporary, path); return; }
    catch (error) {
      if (n === 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await sleep(100);
    }
  }
}

export function validateRequest(request, requestId, repo) {
  const match = REQUEST_ID.exec(requestId);
  if (!match || !record(request) || request.version !== 1 || request.requestId !== requestId ||
      request.candidateCommit !== match[1] || request.repo !== repo ||
      !Number.isFinite(Date.parse(request.createdAt)) ||
      Object.keys(request).some((key) => !['version', 'requestId', 'candidateCommit', 'repo', 'createdAt'].includes(key))) {
    throw new Error('Invalid content queue request');
  }
  return { ...request };
}

// Always compare against deployed CODE, including commits hidden by net reverts.
export async function planContent(source, baseline, candidateCommit) {
  requireSha(candidateCommit);
  const headCommit = await source.head();
  if (candidateCommit !== headCommit) return { mode: 'stale', reason: 'Candidate is no longer main HEAD' };
  if (!SHA.test(baseline?.commit ?? '') || !SHA.test(baseline?.contentCommit ?? '')) {
    return { mode: 'full', reason: 'Publish one paired code/content release to establish the baseline' };
  }
  const comparison = await source.compare(baseline.commit, candidateCommit);
  // Do not let a matching content commit bypass a changed/incompatible code baseline.
  const decision = decideContentUpdate({ codeCommit: baseline.commit, currentContentCommit: null,
    candidateCommit, headCommit, comparison });
  if (decision.mode !== 'content') return decision;
  if (candidateCommit === baseline.contentCommit) return { mode: 'noop', reason: 'Content is already active; check pending cache purge' };
  const order = baseline.contentCommit === baseline.commit ? comparison : await source.compare(baseline.contentCommit, candidateCommit);
  if (order.truncated || order.status !== 'ahead') return { mode: 'full', reason: 'Current content is not a proven ancestor; automatic rewind is refused' };
  return decision;
}

// Dependencies are injected in tests; production implementation below confines all paths.
export async function processContentRequest({ source, request, loadBaseline, assertOrigin, stage,
  activate, purge, ensureReady = async () => {} }) {
  await ensureReady();
  const before = await loadBaseline();
  await assertOrigin(before);
  const decision = await planContent(source, before, request.candidateCommit);
  if (decision.mode === 'full' || decision.mode === 'stale') return { ...decision, status: 'success', originUpdated: false };
  if (decision.mode === 'content') {
    const candidate = await stage(request.candidateCommit);
    // The same deployment lock covers staging, these checks, activation and purge.
    if (await source.head() !== request.candidateCommit) return { mode: 'stale', status: 'success', originUpdated: false, reason: 'Main advanced during download' };
    const after = await loadBaseline();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Production baseline changed during content preparation');
    await assertOrigin(after);
    await activate(candidate, after);
  }
  const result = await purge();
  return { mode: decision.mode, status: result.status === 'success' ? 'success' : 'failed', originUpdated: decision.mode === 'content',
    reason: result.status === 'success' ? 'Origin and EdgeOne cache are current' : 'Origin content is active; cache purge needs retry', purge: result };
}

export async function finishPurge({ state, create, describe, save, pause = sleep, attempts = 12, delayMs = 5000 }) {
  if (state?.status === 'success') return state;
  let next = { ...(state ?? {}), updatedAt: timestamp() };
  try {
    // A failed/expired job needs a fresh request; an unfinished job is only polled.
    if (!next.jobId || ['failed', 'timeout', 'canceled'].includes(next.status)) {
      const result = await create();
      if (typeof result.jobId !== 'string' || !result.jobId.length || result.jobId.length > 128 ||
          /[^A-Za-z0-9_-]/.test(result.jobId)) throw new Error('Invalid EdgeOne job id');
      next = { status: 'pending', jobId: result.jobId, updatedAt: timestamp() };
      await save(next); // persist BEFORE polling so retries never lose a known job
    }
    for (let n = 0; n < attempts; n++) {
      const result = await describe(next.jobId);
      if (result.jobId !== next.jobId || !Array.isArray(result.statuses) ||
          result.statuses.some((s) => !['processing', 'success', 'failed', 'timeout', 'canceled'].includes(s))) throw new Error('Invalid EdgeOne task status');
      if (result.statuses.length && result.statuses.length === result.totalCount) {
        const failure = result.statuses.find((s) => ['failed', 'timeout', 'canceled'].includes(s));
        if (failure || result.statuses.every((s) => s === 'success')) {
          next = { ...next, status: failure ?? 'success', updatedAt: timestamp() };
          await save(next); return next;
        }
      }
      if (n + 1 < attempts) await pause(delayMs);
    }
    next = { ...next, status: 'pending', updatedAt: timestamp() };
  } catch {
    // Do not include provider stderr, credentials or response bodies in runner results.
    next = { ...next, status: 'pending', message: 'EdgeOne request or polling failed; retry this commit', updatedAt: timestamp() };
  }
  await save(next);
  return next;
}

async function loadConfig(path) {
  const config = await readJson(path, { maxBytes: 16384 });
  if (config?.version !== 1 || !isAbsolute(config.root ?? '') || resolve(config.root) === dirname(resolve(config.root)) ||
      !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(config.repo ?? '')) throw new Error('Invalid installed content configuration');
  config.root = resolve(config.root);
  if (resolve(path).toLowerCase() !== join(config.root, 'content-tools', 'config.json').toLowerCase() ||
      TOOL_ROOT.toLowerCase() !== join(config.root, 'content-tools').toLowerCase()) throw new Error('Run the fixed installed content tool with its own config.json');
  for (const key of ['nodePath', 'pm2Path', 'pm2Home', 'tccliPath']) {
    if (!isAbsolute(config[key] ?? '')) throw new Error('Configured executable and PM2 paths must be absolute');
  }
  const origin = new URL(config.origin);
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname) ||
      origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Health origin must be loopback HTTP');
  config.origin = origin.origin;
  return config;
}
async function ps(script, args, config, timeout = 120000) {
  const executable = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const env = { ...process.env, PM2_HOME: config.pm2Home };
  delete env.NODE_OPTIONS; delete env.NODE_PATH;
  try {
    const { stdout } = await execute(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(TOOL_ROOT, 'deploy', script), ...args],
      { cwd: TOOL_ROOT, env, windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    return stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : {};
  } catch (error) {
    // Child scripts suppress raw PM2 environments and provider output. Keep their
    // bounded diagnostics private so failed recovery can be investigated.
    try { await writeJson(join(config.root, 'shared', 'content-operation-error.json'), {
      script, updatedAt: timestamp(), code: error.code ?? null, diagnostic: String(error.stderr ?? '').slice(0, 16384),
    }); } catch { /* preserve the original failure even when the disk is unavailable */ }
    throw new Error('Trusted operation ' + script + ' failed; inspect shared/content-operation-error.json and the private journal');
  }
}
async function fetchBounded(url, maxBytes, fetchImpl = fetch) {
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Origin health returned HTTP ' + response.status); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw new Error('Origin response exceeds health-check bound'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks, size);
}
export async function checkOriginMarker(origin, baseline, fetchImpl = fetch) {
  const marker = JSON.parse((await fetchBounded(origin + '/__release.json', 16384, fetchImpl)).toString('utf8'));
  if (marker.commit !== baseline.commit || marker.id !== baseline.releaseId) throw new Error('Origin release marker differs from the deployed code baseline');
}
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
export async function checkContentHealth({ config, parent, codeCommit, releaseId, fetchImpl = fetch }) {
  const report = await validateContent(parent);
  const manifest = await readJson(join(parent, 'manifest.json'), { optional: true, maxBytes: 4 * 1024 * 1024 }) ??
    await createContentManifest(join(parent, 'content'), codeCommit);
  // Confirm every live byte, not just the sampled HTTP image. Root is the fixed
  // runtime parent, whose value is also verified in the PM2 process projection.
  if (config.root) await verifyContentManifest(join(config.root, 'content'), manifest, manifest.commit);
  await checkOriginMarker(config.origin, { commit: codeCommit, releaseId }, fetchImpl);
  const html = (await fetchBounded(config.origin + '/news', 16 * 1024 * 1024, fetchImpl)).toString('utf8');
  const actual = [...new Set([...html.matchAll(/href="\/news\/([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
  const expected = [...report.summary.articleSlugs].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Origin news slugs differ from the validated content');
  const detail = (await fetchBounded(config.origin + '/news/' + expected[0], 16 * 1024 * 1024, fetchImpl)).toString('utf8');
  if (!detail.includes('<h1')) throw new Error('News detail has no article heading');
  const visibleDetail = detail.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/\s+/g, ' ');
  for (const file of manifest.files.filter((entry) => /^news\/[^/]+\.md$/.test(entry.path))) {
    const article = matter(await readFile(join(parent, 'content', ...file.path.split('/')), 'utf8'));
    if (!html.includes(escapeHtml(article.data.title))) throw new Error('Origin news title differs from the validated content');
    if ((article.data.slug?.trim() || slugify(article.data.title)) !== expected[0]) continue;
    if (!visibleDetail.includes(escapeHtml(article.data.title))) throw new Error('Origin article title differs from the validated content');
    // Check a literal text node from the sampled article's first paragraph;
    // Markdown markup is deliberately not compared byte-for-byte to HTML.
    const paragraph = unified().use(remarkParse).use(remarkGfm).parse(article.content).children.find((node) => node.type === 'paragraph');
    const pending = [...(paragraph?.children ?? [])];
    let snippet;
    while (pending.length && !snippet) {
      const node = pending.shift();
      if (node.type === 'text' && node.value.trim()) snippet = node.value.trim().slice(0, 160);
      else if (node.children) pending.unshift(...node.children);
    }
    if (snippet && !visibleDetail.includes(escapeHtml(snippet).replace(/\s+/g, ' '))) throw new Error('Origin article text differs from the validated content');
  }
  const board = yaml.load(await readFile(join(parent, 'content', 'leaderboard', 'index.yml'), 'utf8'));
  const rows = [...html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' '));
  for (const entry of [...board.entries].sort((a, b) => a.rank - b.rank).slice(0, 8)) {
    if (!rows.some((row) => row.includes(escapeHtml(entry.player.trim())) && row.includes(entry.score.toLocaleString() + ' 胜'))) throw new Error('Origin leaderboard differs from the validated content');
  }
  // File integrity is checked for the entire snapshot; HTTP samples routing too.
  const image = manifest.files.find((file) => file.path.startsWith('news/images/'));
  if (image) {
    const path = image.path.split('/').map(encodeURIComponent).join('/');
    const bytes = await fetchBounded(config.origin + '/content/' + path, 32 * 1024 * 1024, fetchImpl);
    if (bytes.length !== image.size || createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('Origin image differs from the validated content');
  }
  return { healthy: true, articleCount: expected.length };
}

async function verifyCandidate(parent, commit) {
  requireSha(commit);
  const manifest = await readJson(join(parent, 'manifest.json'), { maxBytes: 4 * 1024 * 1024 });
  await verifyContentManifest(join(parent, 'content'), manifest, commit);
  await validateContent(parent);
  return manifest;
}
async function baselineFromPrivate(config) {
  const deployed = await readJson(join(config.root, 'shared', 'deployment-state.json'));
  const current = deployed?.current;
  if (!SHA.test(current?.commit ?? '') || !/^[a-z0-9-]+$/.test(current?.id ?? '') || current.legacy) throw new Error('A healthy versioned program release is required');
  const content = await readJson(join(config.root, 'shared', 'content-state.json'), { optional: true });
  if (content && (content.version !== 1 || content.codeCommit !== current.commit ||
      (content.contentCommit && !SHA.test(content.contentCommit)))) throw new Error('Private code/content state is inconsistent');
  return { commit: current.commit, releaseId: current.id, contentCommit: content?.contentCommit ?? null };
}
async function purgeCurrentContent(config, configPath) {
  const path = join(config.root, 'shared', 'content-state.json');
  const state = await readJson(path);
  return finishPurge({ state: state.purge,
    create: () => ps('invoke-content-purge.ps1', ['-Config', configPath, '-Action', 'Create'], config),
    describe: (jobId) => ps('invoke-content-purge.ps1', ['-Config', configPath, '-Action', 'Describe', '-JobId', jobId], config),
    save: async (purge) => { state.purge = purge; state.updatedAt = timestamp(); await writeJson(path, state); } });
}
async function processQueue(config, configPath, requestId) {
  if (!REQUEST_ID.test(requestId ?? '')) throw new Error('Invalid request id');
  const resultPath = join(config.root, 'coordination', 'results', requestId + '.json');
  if (await readJson(resultPath, { optional: true })) return; // immutable per-attempt result
  let result;
  try {
    const request = validateRequest(await readJson(join(config.root, 'coordination', 'queue', requestId + '.json'), { maxBytes: 4096 }), requestId, config.repo);
    // Queue is runner-writable: retain the validated value in memory, never reread it.
    const secrets = await readJson(join(config.root, 'shared', 'content-sync-secrets.json'), { optional: true, maxBytes: 16384 });
    // The runner's ephemeral token is not inherited by the independent S4U task.
    // Anonymous GitHub quota is too small for sustained per-commit/blob checks.
    if (typeof secrets?.githubToken !== 'string' || !secrets.githubToken.trim()) throw new Error('Administrator GitHub read token is not configured in shared/content-sync-secrets.json');
    const source = new GitHubContentSource({ repo: config.repo, token: secrets.githubToken });
    result = await processContentRequest({ source, request,
      ensureReady: async () => {
        const journal = await readJson(join(config.root, 'shared', 'content-journal.json'), { optional: true });
        if (journal && journal.completed !== true) throw new Error('An unfinished maintenance journal requires administrator recovery');
      },
      loadBaseline: () => baselineFromPrivate(config),
      assertOrigin: (baseline) => checkOriginMarker(config.origin, baseline),
      stage: async (commit) => {
        const parent = within(join(config.root, 'coordination', 'staging'), join(config.root, 'coordination', 'staging', 'download-' + requestId));
        await noLinks(parent);
        await mkdir(parent); // never overwrite a partial/previous operation
        const manifest = await source.snapshot(commit, parent);
        await writeJson(join(parent, 'manifest.json'), manifest, { exclusive: true });
        await verifyCandidate(parent, commit);
        return parent;
      },
      activate: (parent, baseline) => ps('activate-content.ps1', ['-Config', configPath, '-CandidateParent', parent, '-OperationId', requestId,
        '-ContentCommit', request.candidateCommit, '-CodeCommit', baseline.commit, '-ReleaseId', baseline.releaseId, '-LockHeld'], config, 300000),
      purge: () => purgeCurrentContent(config, configPath),
    });
  } catch (error) {
    // Only our bounded, data-only diagnostic messages are returned. Never raw provider/PM2 output.
    const safe = /^(Administrator GitHub|Invalid content queue|A healthy versioned|Private code\/content|Origin |An unfinished maintenance|Trusted operation|Content |GitHub |Snapshot |main |A complete |Downloaded |Only |Staging |The commit |Comparison |Current |Production |Symbolic )/.test(error.message);
    result = { status: 'failed', mode: 'content', message: safe ? error.message.slice(0, 500) : 'Content synchronization failed before completion; inspect the administrator task log' };
    // A briefly online failed candidate may have populated CDN entries before
    // rollback. Clear those too, without hiding the original failed operation.
    const journal = await readJson(join(config.root, 'shared', 'content-journal.json'), { optional: true });
    if (journal?.operationId === requestId && journal.completed === true && journal.phase === 'rolled-back') {
      try { result.recoveryPurge = await purgeCurrentContent(config, configPath); }
      catch { result.recoveryPurge = { status: 'pending' }; }
    }
  }
  await writeJson(resultPath, { version: 1, requestId, candidateCommit: requestId.slice(0, 40), ...result, updatedAt: timestamp() }, { exclusive: true });
}

async function emitResult(result) {
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT && ['content', 'full', 'noop', 'stale'].includes(result.mode)) await appendFile(process.env.GITHUB_OUTPUT, 'mode=' + result.mode + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    'Content delivery: **' + (result.mode ?? 'failed') + '** / ' + result.status + '. ' + (result.reason ?? result.message ?? '') + '\n');
  if (result.status === 'failed') process.exitCode = 1;
}
async function enqueue(config, candidate, requestId) {
  const request = validateRequest({ version: 1, requestId, candidateCommit: candidate, repo: config.repo, createdAt: timestamp() }, requestId, config.repo);
  const baseline = await readJson(join(config.root, 'coordination', 'code', 'current.json'));
  const source = new GitHubContentSource({ repo: config.repo, token: process.env.GITHUB_TOKEN });
  const decision = await planContent(source, baseline, candidate);
  if (['full', 'stale'].includes(decision.mode)) return emitResult({ ...decision, status: 'success' });
  const path = join(config.root, 'coordination', 'queue', requestId + '.json');
  const existing = await readJson(path, { optional: true, maxBytes: 4096 });
  if (existing) validateRequest(existing, requestId, config.repo);
  else {
    // Publish a whole JSON document; task enumeration ignores temporary files.
    await writeJson(path, request);
  }
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    const result = await readJson(join(config.root, 'coordination', 'results', requestId + '.json'), { optional: true, maxBytes: 16384 });
    if (result) {
      if (result.version !== 1 || result.requestId !== requestId || !['success', 'failed'].includes(result.status)) throw new Error('Invalid administrator result');
      return emitResult(result);
    }
    await sleep(2000);
  }
  throw new Error('Administrator task did not return within 12 minutes; execution may still be pending. Inspect its result before rerunning');
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!key.startsWith('--') || Object.hasOwn(options, key)) throw new Error('Invalid or duplicate command option');
    if (key === '--lock-held') options[key] = true;
    else { if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing command option value'); options[key] = args[++index]; }
  }
  return options;
}
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  if (command === 'verify-candidate') { await verifyCandidate(resolve(options['--parent']), options['--commit']); console.log('{"valid":true}'); return; }
  const configPath = resolve(options['--config']);
  const config = await loadConfig(configPath);
  if (command === 'enqueue') return enqueue(config, options['--candidate'], options['--request-id']);
  if (command === 'process-request') {
    if (!options['--lock-held']) throw new Error('Use the administrator queue processor to hold the deployment lock');
    return processQueue(config, configPath, options['--request-id']);
  }
  if (command === 'prepare-release') {
    if (!options['--lock-held']) throw new Error('Publisher must hold the deployment lock');
    const release = within(config.root, resolve(options['--release']));
    const manifest = await readJson(join(release, 'release.json'));
    if (manifest.contentSyncVersion !== 1) throw new Error('Release does not declare contentSyncVersion 1');
    await verifyCandidate(join(release, 'content-snapshot'), manifest.commit);
    console.log('{"valid":true}'); return;
  }
  if (command === 'health') {
    const parent = resolve(options['--parent']);
    if (parent.toLowerCase() !== config.root.toLowerCase()) within(config.root, parent);
    const codeCommit = requireSha(options['--code-commit']);
    const deadline = Date.now() + 60000;
    for (;;) {
      try {
        const result = await checkContentHealth({ config, parent, codeCommit, releaseId: options['--release-id'] });
        console.log(JSON.stringify(result)); return;
      } catch (error) { if (Date.now() >= deadline) throw error; await sleep(1000); }
    }
  }
  throw new Error('Expected enqueue, process-request, prepare-release, verify-candidate or health');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error('content-sync: ' + error.message); process.exitCode = 1; });
}
