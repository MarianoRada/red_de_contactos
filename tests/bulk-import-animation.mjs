import assert from 'node:assert/strict';
import { shouldReplayGraphIntro } from '../src/lib/bulkImportAnimation.ts';

const result = (overrides = {}) => ({
  idempotent: false,
  inserted: { records: 0, relationships: 0 },
  ...overrides,
});

assert.equal(
  shouldReplayGraphIntro(result({ inserted: { records: 2, relationships: 1 } })),
  true,
  'a real import mutation should replay the graph intro'
);

assert.equal(
  shouldReplayGraphIntro(result({ inserted: { records: 0, relationships: 3 } })),
  true,
  'a relationships-only mutation should replay the graph intro'
);

assert.equal(
  shouldReplayGraphIntro(
    result({ idempotent: true, inserted: { records: 2, relationships: 1 } })
  ),
  false,
  'an idempotent response should not replay the graph intro'
);

assert.equal(
  shouldReplayGraphIntro(result()),
  false,
  'a successful no-op should not replay the graph intro'
);

console.log('Bulk import animation policy tests passed: mutations, relationships-only, idempotency, and no-op cases.');
