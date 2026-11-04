import assert from "node:assert/strict";
import test from "node:test";

import { intParam, listPaging } from "../src/lib/reactenzdb-api.ts";

test("list pagination preserves the documented default", () => {
  assert.deepEqual(listPaging(new URLSearchParams()), { page: 1, pageSize: 20 });
  assert.deepEqual(listPaging(new URLSearchParams("page=&pageSize=")), { page: 1, pageSize: 20 });
});

test("list pagination accepts and clamps the documented page-size range", () => {
  for (const [raw, expected] of [
    ["1", 1],
    ["20", 20],
    ["100", 100],
    ["101", 100],
    ["0", 1],
    ["invalid", 20],
  ]) {
    assert.equal(listPaging(new URLSearchParams({ pageSize: raw })).pageSize, expected);
  }
});

test("integer parameters use the fallback for missing, blank, and non-numeric values", () => {
  assert.equal(intParam(new URLSearchParams(), "limit", 20, 1, 100), 20);
  assert.equal(intParam(new URLSearchParams("limit="), "limit", 20, 1, 100), 20);
  assert.equal(intParam(new URLSearchParams("limit=nope"), "limit", 20, 1, 100), 20);
});
