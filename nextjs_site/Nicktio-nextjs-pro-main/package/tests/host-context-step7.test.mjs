import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../src/app");
const reaction = fs.readFileSync(path.join(root, "reactions", "[reactionId]", "page.tsx"), "utf8");
const enzyme = fs.readFileSync(path.join(root, "enzymes", "[biopartId]", "page.tsx"), "utf8");
const browse = fs.readFileSync(path.join(root, "browse", "page.tsx"), "utf8");

const hostsPage = fs.readFileSync(path.join(root, "hosts", "page.tsx"), "utf8");
const preliminaryPage = fs.readFileSync(path.join(root, "hosts", "preliminary", "page.tsx"), "utf8");

test("reaction detail shows only the staging host mapping", () => {
  assert.match(reaction, /Section id="host-context" title="Host Context"/);
  assert.match(reaction, /getLocalMappingsForReaction/);
  assert.match(reaction, /mapping_status !== "NOT_MAPPED"/);
  assert.match(reaction, /Omission is not biological absence/);
  assert.doesNotMatch(reaction, /Legacy 12-host snapshot/);
  assert.doesNotMatch(reaction, /preliminary-host-context/);
  assert.doesNotMatch(reaction, /getReactionHostContexts|ReactionHostContextPanel/);
  assert.doesNotMatch(reaction, /"native metabolic reaction"/);
  assert.doesNotMatch(reaction, /getReactionHostMapping|FROM reaction_host_mapping/);
});

test("the 12-host HTML layer is withdrawn from the current site", () => {
  assert.match(preliminaryPage, /permanentRedirect\("\/hosts"\)/);
  assert.doesNotMatch(hostsPage, /hosts\/preliminary/);
  assert.doesNotMatch(reaction, /hosts\/preliminary/);
});

test("enzyme detail links through reactions without a compatibility score", () => {
  assert.match(enzyme, /Open host context on a reaction/);
  assert.match(enzyme, /No enzyme–host compatibility score is calculated here/);
  assert.match(enzyme, /#host-context/);
  assert.doesNotMatch(enzyme, /getEnzymeHostScore|hostSuitabilityScore/);
});

test("Browse cannot silently apply a host filter before mapping release", () => {
  assert.doesNotMatch(browse, /getLocalReactionIdsByHostStatus/);
  assert.doesNotMatch(browse, /localPreviewReactionIds/);
  assert.doesNotMatch(browse, /PendingHostFilter/);
});
