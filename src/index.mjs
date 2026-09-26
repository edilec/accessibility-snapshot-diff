export const TOOL_ID = 'accessibility-snapshot-diff';
export const LIMITS = Object.freeze({ bytes: 1_048_576, nodes: 300, ignoreIds: 50, depth: 4, milliseconds: 5000 });
export const RULE_SEVERITY = Object.freeze({
  'input-unreadable': 'error', 'input-invalid': 'error', 'duplicate-key': 'error', 'byte-limit': 'error', 'record-limit': 'error', 'policy-limit': 'error', 'depth-limit': 'error', 'time-limit': 'error', 'export-incomplete': 'error', 'node-invalid': 'error', 'identity-ambiguous': 'error', 'structure-unknown': 'error', 'no-nodes': 'error', 'policy-invalid': 'error',
  'node-removed': 'error', 'node-added': 'error', 'role-changed': 'error', 'parent-changed': 'error', 'name-removed': 'error', 'name-changed': 'error', 'name-added': 'error', 'heading-level-changed': 'error'
});
const UNKNOWN = new Set(['input-unreadable', 'input-invalid', 'duplicate-key', 'byte-limit', 'record-limit', 'policy-limit', 'depth-limit', 'time-limit', 'export-incomplete', 'node-invalid', 'identity-ambiguous', 'structure-unknown', 'no-nodes', 'policy-invalid']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(v);
const renderedName = value => {
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, character => /\s/u.test(character) ? ' ' : '')
    .replace(/[\u00ad\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, '')
    .replace(/\s+/gu, ' ').trim();
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(text) ? text : '';
};
function finding(ruleId, pointer = '') {
  if (!Object.hasOwn(RULE_SEVERITY, ruleId)) throw new Error('Unknown rule');
  return { ruleId, severity: RULE_SEVERITY[ruleId], message: {
    'node-removed': 'A baseline accessibility node is missing from the current snapshot.',
    'node-added': 'The current snapshot has a new accessibility node.',
    'role-changed': 'An accessibility role changed.',
    'parent-changed': 'A node moved to a different structural parent.',
    'name-removed': 'An accessible name was removed.',
    'name-changed': 'An accessible name changed.',
    'name-added': 'An accessible name was added.',
    'heading-level-changed': 'A heading level changed.'
  }[ruleId] ?? 'Accessibility evidence cannot be evaluated safely.', location: { file: '@export', pointer } };
}
function report(findings, changes = [], checked = 0) {
  findings.sort((a, b) => order(a.location.file, b.location.file) || order(a.location.pointer, b.location.pointer) || order(a.ruleId, b.ruleId));
  return { schemaVersion: '1', tool: TOOL_ID, status: findings.some(f => UNKNOWN.has(f.ruleId)) ? 'incomplete' : findings.length ? 'fail' : 'pass', summary: { checked, errors: findings.length, warnings: 0 }, changes, findings };
}
export const incomplete = ruleId => report([finding(ruleId)]);
export function parseStrictJson(raw) {
  const value = JSON.parse(raw); let i = 0;
  const space = () => { while (/\s/u.test(raw[i] ?? '')) i++; };
  const token = () => { const start = i++; while (i < raw.length) { if (raw[i] === '\\') { i += 2; continue; } if (raw[i++] === '"') return JSON.parse(raw.slice(start, i)); } throw new Error('input-invalid'); };
  const walk = depth => { if (depth > LIMITS.depth) throw new Error('depth-limit'); space(); if (raw[i] === '{') { i++; space(); const keys = new Set(); while (raw[i] !== '}') { const key = token(); if (keys.has(key)) throw new Error('duplicate-key'); keys.add(key); space(); i++; walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); } i++; return; } if (raw[i] === '[') { i++; space(); while (raw[i] !== ']') { walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); } i++; return; } if (raw[i] === '"') { token(); return; } while (i < raw.length && !/[\s,}\]]/u.test(raw[i])) i++; };
  walk(0); return value;
}
function tooDeep(v, depth = 0) { return depth > LIMITS.depth || (v !== null && typeof v === 'object' && Object.values(v).some(child => tooDeep(child, depth + 1))); }
function validNode(node) {
  return object(node) && id(node.id) && (node.parentId === null || id(node.parentId)) && id(node.role) && typeof node.name === 'string' && node.name.length <= 512 && (node.role === 'heading' ? Number.isInteger(node.level) && node.level >= 1 && node.level <= 6 : node.level === undefined) && Object.keys(node).every(k => ['id', 'parentId', 'role', 'name', 'level'].includes(k));
}
function index(nodes, role, expired) {
  const map = new Map();
  for (const [i, node] of nodes.entries()) {
    if (expired()) return { error: finding('time-limit') };
    if (!validNode(node)) return { error: finding('node-invalid', `/${role}/nodes/${i}`) };
    if (map.has(node.id)) return { error: finding('identity-ambiguous', `/${role}/nodes/${i}`) };
    map.set(node.id, { node, ordinal: i });
  }
  for (const [i, node] of nodes.entries()) {
    if (node.parentId !== null && !map.has(node.parentId)) return { error: finding('structure-unknown', `/${role}/nodes/${i}`) };
    const visited = new Set([node.id]); let parent = node.parentId;
    while (parent !== null) {
      if (visited.has(parent)) return { error: finding('structure-unknown', `/${role}/nodes/${i}`) };
      visited.add(parent); parent = map.get(parent).node.parentId;
    }
  }
  return { map };
}
export function diffSnapshots(document, { now = Date.now } = {}) {
  const start = now(), expired = () => now() - start > LIMITS.milliseconds;
  if (!object(document)) return incomplete('input-invalid');
  let bytes; try { bytes = Buffer.byteLength(JSON.stringify(document)); } catch { return incomplete('input-invalid'); }
  if (bytes > LIMITS.bytes) return incomplete('byte-limit');
  if (tooDeep(document)) return incomplete('depth-limit');
  if (expired()) return incomplete('time-limit');
  if (document.schemaVersion !== '1' || !object(document.baseline) || !object(document.current) || !object(document.policy) || !Array.isArray(document.baseline.nodes) || !Array.isArray(document.current.nodes) || !Array.isArray(document.policy.ignoreNameIds) || Object.keys(document).some(k => !['schemaVersion', 'complete', 'baseline', 'current', 'policy', 'note'].includes(k)) || (document.note !== undefined && typeof document.note !== 'string')) return incomplete('input-invalid');
  if (document.complete !== true || document.baseline.complete !== true || document.current.complete !== true) return incomplete('export-incomplete');
  if (Object.keys(document.baseline).some(k => !['complete', 'nodes'].includes(k)) || Object.keys(document.current).some(k => !['complete', 'nodes'].includes(k)) || Object.keys(document.policy).some(k => k !== 'ignoreNameIds')) return incomplete('input-invalid');
  if (document.baseline.nodes.length > LIMITS.nodes || document.current.nodes.length > LIMITS.nodes) return incomplete('record-limit');
  if (document.policy.ignoreNameIds.length > LIMITS.ignoreIds) return incomplete('policy-limit');
  if (!document.baseline.nodes.length || !document.current.nodes.length) return incomplete('no-nodes');
  const before = index(document.baseline.nodes, 'baseline', expired); if (before.error) return report([before.error]);
  const after = index(document.current.nodes, 'current', expired); if (after.error) return report([after.error]);
  const ignored = new Set(document.policy.ignoreNameIds);
  if (ignored.size !== document.policy.ignoreNameIds.length || [...ignored].some(x => !id(x) || !before.map.has(x))) return incomplete('policy-invalid');
  const findings = [], changes = [];
  const add = (kind, baselineOrdinal, currentOrdinal, pointer) => { changes.push({ kind, baselineOrdinal, currentOrdinal }); findings.push(finding(kind, pointer)); };
  for (const [i, node] of document.baseline.nodes.entries()) {
    if (expired()) return incomplete('time-limit');
    const current = after.map.get(node.id), pointer = `/baseline/nodes/${i}`;
    if (!current) { add('node-removed', i, -1, pointer); continue; }
    const next = current.node, j = current.ordinal;
    if (node.role !== next.role) add('role-changed', i, j, pointer);
    if (node.parentId !== next.parentId) add('parent-changed', i, j, pointer);
    if (node.role === 'heading' && next.role === 'heading' && node.level !== next.level) add('heading-level-changed', i, j, pointer);
    const oldName = renderedName(node.name), newName = renderedName(next.name);
    if (!ignored.has(node.id) && oldName !== newName) add(oldName && !newName ? 'name-removed' : !oldName && newName ? 'name-added' : 'name-changed', i, j, pointer);
  }
  for (const [i, node] of document.current.nodes.entries()) {
    if (expired()) return incomplete('time-limit');
    if (!before.map.has(node.id)) add('node-added', -1, i, `/current/nodes/${i}`);
  }
  if (expired()) return incomplete('time-limit');
  return report(findings, changes, document.baseline.nodes.length);
}
