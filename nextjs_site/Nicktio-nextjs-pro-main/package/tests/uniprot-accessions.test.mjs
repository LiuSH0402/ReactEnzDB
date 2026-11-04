import assert from "node:assert/strict";
import test from "node:test";
import { isUniProtAccession } from "../src/lib/uniprotAccessions.ts";

test("restored six- and ten-character accession formats are recognized", () => {
  for (const value of ["I3LD43", "P0A2X8", "A0A0D1DNP7", "a0a0d1dnp7", " P28839 "])
    assert.equal(isUniProtAccession(value), true, value);
});
test("isoforms preserve their explicit accession suffix", () => {
  for (const value of ["P28839-2", "A0A0D1DNP7-10"])
    assert.equal(isUniProtAccession(value), true, value);
  for (const value of ["P28839-0", "P28839-", "P28839-2-extra"])
    assert.equal(isUniProtAccession(value), false, value);
});
test("other search identifiers and partial or malformed accessions are excluded", () => {
  for (const value of ["", "RHEA:11084", "OENC248856", "REO001234", "CCO", "A0A0D1DNP", "A0A0D1DNP77", "P28'839"])
    assert.equal(isUniProtAccession(value), false, value);
});
