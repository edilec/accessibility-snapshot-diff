import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { diffSnapshots, LIMITS, parseStrictJson } from '../src/index.mjs';

const node = (id, role, name, parentId = null, level) => ({ id, parentId, role, name, ...(level === undefined ? {} : { level }) });
const base = [node('main', 'main', ''), node('heading', 'heading', 'Overview', 'main', 2), node('button', 'button', 'Save', 'main'), node('count', 'status', '3 items', 'main')];
const doc = (before = base, after = base, ignoreNameIds = []) => ({ schemaVersion: '1', complete: true, baseline: { complete: true, nodes: before.map(x => ({ ...x })) }, current: { complete: true, nodes: after.map(x => ({ ...x })) }, policy: { ignoreNameIds: [...ignoreNameIds] } });
const run = (root, input) => spawnSync(process.execPath, ['bin/accessibility-snapshot-diff.mjs', '--root', root, '--input', input], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--import=/Users/km/Desktop/web/open-source/migration-plan-template/support/deny-network.mjs' } });

test('good identical exported accessibility trees pass', () => { const r = diffSnapshots(doc()); assert.equal(r.status, 'pass'); assert.equal(r.summary.checked, 4); assert.deepEqual(r.changes, []); });
test('lost accessible button name and changed heading level have located structural diffs', () => {
  const changed = [base[0], node('heading', 'heading', 'Overview', 'main', 3), node('button', 'button', '', 'main'), base[3]];
  const r = diffSnapshots(doc(base, changed)); assert.equal(r.status, 'fail');
  assert.deepEqual(r.changes.map(x => x.kind), ['heading-level-changed', 'name-removed']);
  assert.deepEqual(r.changes.map(x => x.currentOrdinal), [1, 2]);
  assert.equal(JSON.stringify(r).includes('Overview'), false);
});
test('bidi-format-only current name is a removed accessible name', () => {
  const changed = [base[0], base[1], node('button', 'button', '\u200e', 'main'), base[3]];
  const r = diffSnapshots(doc(base, changed));
  assert.equal(r.status, 'fail');
  assert.equal(r.changes[0].kind, 'name-removed');
  assert.equal(JSON.stringify(r).includes('\u200e'), false);
});
test('joiner inside visible emoji text remains a usable matching name', () => {
  const heading = node('people', 'heading', 'Meet 👩‍💻 developers', null, 2);
  assert.equal(diffSnapshots(doc([heading], [heading])).status, 'pass');
});
test('line break between words preserves a matching accessible name', () => {
  const changed = [base[0], base[1], node('button', 'button', 'Save\nnow', 'main'), base[3]];
  const before = [base[0], base[1], node('button', 'button', 'Save now', 'main'), base[3]];
  assert.equal(diffSnapshots(doc(before, changed)).status, 'pass');
});
test('explicit dynamic-count name ignore passes, but never hides a removed node', () => {
  const changed = [base[0], base[1], base[2], node('count', 'status', '4 items', 'main')];
  assert.equal(diffSnapshots(doc(base, changed)).status, 'fail');
  assert.equal(diffSnapshots(doc(base, changed, ['count'])).status, 'pass');
  assert.equal(diffSnapshots(doc(base, changed.slice(0, 3), ['count'])).status, 'fail');
});
test('stable IDs detect parent moves and role changes independent of row order', () => {
  assert.equal(diffSnapshots(doc(base, [...base].reverse())).status, 'pass');
  const moved = [base[0], base[1], node('button', 'button', 'Save', 'heading'), base[3]];
  assert.equal(diffSnapshots(doc(base, moved)).changes[0].kind, 'parent-changed');
  const role = [base[0], base[1], node('button', 'link', 'Save', 'main'), base[3]];
  assert.equal(diffSnapshots(doc(base, role)).changes[0].kind, 'role-changed');
});
test('partial snapshots, duplicate IDs, broken parents, and empty evidence never pass', () => {
  assert.equal(diffSnapshots({ ...doc(), complete: false }).status, 'incomplete');
  assert.equal(diffSnapshots({ ...doc(), current: { complete: false, nodes: base } }).status, 'incomplete');
  assert.equal(diffSnapshots(doc([], [])).status, 'incomplete');
  assert.equal(diffSnapshots(doc(base, base.concat(base[1]))).findings[0].ruleId, 'identity-ambiguous');
  assert.equal(diffSnapshots(doc(base, base.concat(node('orphan', 'button', 'X', 'missing')))).status, 'incomplete');
});
test('node count, ignore count, byte, depth, and clock bounds enforce N and N+1', () => {
  const many = [node('root', 'main', ''), ...Array.from({ length: LIMITS.nodes - 1 }, (_, i) => node(`id${i}`, 'text', 'x', 'root'))];
  assert.equal(diffSnapshots(doc(many, many)).status, 'pass'); assert.equal(diffSnapshots(doc(many.concat(node('extra', 'text', 'x', 'root')), many)).findings[0].ruleId, 'record-limit');
  const ignored = Array.from({ length: LIMITS.ignoreIds }, (_, i) => `id${i}`); assert.equal(diffSnapshots(doc(many, many, ignored)).status, 'pass'); assert.equal(diffSnapshots(doc(many, many, ignored.concat('extra'))).findings[0].ruleId, 'policy-limit');
  const x = doc(); x.note = ''; const overhead = Buffer.byteLength(JSON.stringify(x)); x.note = 'x'.repeat(LIMITS.bytes - overhead); assert.equal(diffSnapshots(x).status, 'pass'); x.note += 'x'; assert.equal(diffSnapshots(x).findings[0].ruleId, 'byte-limit');
  const deep = doc(); assert.equal(diffSnapshots(deep).status, 'pass'); deep.current.nodes[0].name = { nested: 'x' }; assert.equal(diffSnapshots(deep).findings[0].ruleId, 'depth-limit');
  assert.equal(diffSnapshots(doc(), { now: (() => { let n = 0; return () => n++ ? LIMITS.milliseconds : 0; })() }).status, 'pass');
  assert.equal(diffSnapshots(doc(), { now: (() => { let n = 0; return () => n++ ? LIMITS.milliseconds + 1 : 0; })() }).findings[0].ruleId, 'time-limit');
});
test('duplicate JSON keys including escaped completeness spelling are refused', () => assert.throws(() => parseStrictJson('{"complete":false,"complet\\u0065":true}'), /duplicate-key/));
test('CLI confines reads and distinguishes invalid root from unreadable input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'a11y-')); await writeFile(join(root, 'good.json'), JSON.stringify(doc())); assert.equal(run(root, 'good.json').status, 0);
  await writeFile(join(root, 'bad.json'), Buffer.from([0xff])); assert.equal(JSON.parse(run(root, 'bad.json').stdout).status, 'incomplete');
  await symlink(tmpdir(), join(root, 'escape')); assert.equal(JSON.parse(run(root, 'escape/no.json').stdout).status, 'incomplete');
  assert.equal(run(join(root, 'missing-root'), 'good.json').stdout, '');
  const usage = spawnSync(process.execPath, ['bin/accessibility-snapshot-diff.mjs', '--root', root, '--input', 'good.json', '--bad'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }); assert.equal(usage.status, 2); assert.equal(usage.stdout, '');
});
