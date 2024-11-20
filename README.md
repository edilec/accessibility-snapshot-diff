# Accessibility Snapshot Diff

`accessibility-snapshot-diff` compares two already-exported accessibility-tree snapshots. Stable opaque node IDs locate structural and accessible-name regressions without printing potentially private names. It does not launch a browser or inspect a live page. Node.js 22+; zero dependencies.

## Quick start

```sh
node bin/accessibility-snapshot-diff.mjs --root examples --input passing.json
node bin/accessibility-snapshot-diff.mjs --root examples --input failing.json
npm run check
```

The passing example exits `0`; the failing example exits `1` for a removed button name and changed heading level. Invalid CLI configuration exits `2` with empty stdout. Unreadable or unusable export evidence exits `2` with an `incomplete` JSON report. Stdout is otherwise exactly one JSON report. The real input path must remain inside the real `--root`.

## Export format

```json
{
  "schemaVersion": "1",
  "complete": true,
  "baseline": { "complete": true, "nodes": [
    { "id": "root", "parentId": null, "role": "main", "name": "" },
    { "id": "title", "parentId": "root", "role": "heading", "name": "Overview", "level": 2 }
  ] },
  "current": { "complete": true, "nodes": [
    { "id": "root", "parentId": null, "role": "main", "name": "" },
    { "id": "title", "parentId": "root", "role": "heading", "name": "Overview", "level": 2 }
  ] },
  "policy": { "ignoreNameIds": [] }
}
```

`id` and `parentId` are stable exporter-provided identities. Every non-root parent must exist in its own snapshot; cycles and duplicate IDs make identity unknown. A heading requires `level` 1–6; other roles forbid it. The tool compares matching IDs for role, parent, rendered accessible name, and heading level, and flags added or removed IDs. For name comparison it removes controls and bidi/zero-width formatting (but preserves joiners within visible text), trims surrounding whitespace, and treats a string with no visible letters, numbers, punctuation, or symbols as empty. Source row order does not define identity. `policy.ignoreNameIds` explicitly exempts *only name changes* for listed baseline IDs, useful for dynamic counts; it never hides removal, role, or structure changes. An optional top-level string `note` is ignored.

## Rule catalog

| Rule | Severity | Status / exit |
| --- | --- | --- |
| `node-removed`, `node-added`, `role-changed`, `parent-changed`, `name-removed`, `name-changed`, `name-added`, `heading-level-changed` | error | fail / `1` |
| `input-unreadable`, `input-invalid`, `duplicate-key`, `byte-limit`, `record-limit`, `policy-limit`, `depth-limit`, `time-limit`, `export-incomplete`, `node-invalid`, `identity-ambiguous`, `structure-unknown`, `no-nodes`, `policy-invalid` | error | incomplete / `2` |

The v1 report contains `schemaVersion`, `tool`, `status`, `summary`, `changes`, and `findings`. A change carries its kind and zero-based baseline/current source ordinals (a missing side is `-1`). Findings use logical source role `@export` and a JSON pointer into the exact input file; names and IDs are never echoed. Findings sort by UTF-16 code-unit `(location.file, location.pointer, ruleId)`.

## Limits and non-goals

Strict UTF-8; maximum 1,048,576 input bytes, 300 nodes per snapshot, 50 ignored IDs, JSON depth 4 (root is 0), 5,000 ms injected processing time. Exact N and N+1 boundary tests cover every bound. IDs and roles are 1–128 code units; names at most 512 code units. Duplicate JSON keys, including escaped spellings, and unknown fields are refused.

This is a structural comparison of supplied exports, not a WCAG audit, accessible-name computation, visual check, or proof that the snapshots accurately represent a browser. The tool makes no network calls and writes no artifacts.
