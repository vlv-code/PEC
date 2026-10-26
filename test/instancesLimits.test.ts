import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import {
  enrollInstanceToken,
  getInstanceMeta,
  MAX_PERSISTENT_META,
  prunePersistentMeta,
  _setPersistentMetaEntryForTesting,
  _clearPersistentMetaForTesting,
} from "../src/instances.js";

test("H-6: Persistent metadata bounded growth and FIFO eviction", () => {
  assert.strictEqual(typeof prunePersistentMeta, "function", "prunePersistentMeta must be exported as a function");
  assert.strictEqual(MAX_PERSISTENT_META, 5000, "MAX_PERSISTENT_META must be 5000");

  _clearPersistentMetaForTesting();

  // Populate persistentMeta to exactly MAX_PERSISTENT_META
  for (let i = 0; i < MAX_PERSISTENT_META; i++) {
    _setPersistentMetaEntryForTesting(`inst_fifo_${i}`, { tokenHash: `hash_${i}` });
  }

  // Verify first and last entries exist
  assert.ok(getInstanceMeta("inst_fifo_0"));
  assert.ok(getInstanceMeta(`inst_fifo_${MAX_PERSISTENT_META - 1}`));

  // Enroll one new instance via enrollInstanceToken - should trigger prunePersistentMeta and FIFO eviction
  enrollInstanceToken("inst_new_1", "hash_new_1");

  // inst_fifo_0 should now be evicted
  assert.strictEqual(getInstanceMeta("inst_fifo_0"), undefined, "Oldest entry inst_fifo_0 must be evicted");

  // inst_fifo_1 through inst_fifo_4999 should still exist
  assert.ok(getInstanceMeta("inst_fifo_1"), "inst_fifo_1 must be retained");
  assert.ok(getInstanceMeta(`inst_fifo_${MAX_PERSISTENT_META - 1}`), "inst_fifo_4999 must be retained");

  // inst_new_1 must be present
  const newMeta = getInstanceMeta("inst_new_1");
  assert.ok(newMeta, "Newly enrolled instance must be present");
  assert.strictEqual(newMeta?.tokenHash, "hash_new_1");

  // Add 5 more entries directly and call prunePersistentMeta()
  for (let i = 1; i <= 5; i++) {
    _setPersistentMetaEntryForTesting(`inst_overflow_${i}`, { tokenHash: `hash_overflow_${i}` });
  }
  prunePersistentMeta();

  // inst_fifo_1 through inst_fifo_5 should now be evicted
  for (let i = 1; i <= 5; i++) {
    assert.strictEqual(getInstanceMeta(`inst_fifo_${i}`), undefined, `inst_fifo_${i} must be evicted`);
  }
  // Overflow entries must be retained
  assert.ok(getInstanceMeta("inst_overflow_5"));

  // Clean up
  _clearPersistentMetaForTesting();
});
