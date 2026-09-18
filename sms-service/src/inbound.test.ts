import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInbound, matchVerb, HELP_TEXT } from "./inbound";

// NG-6: inbound parser — exact, typo-tolerant, prefix, fail-loud unknown.
test("exact commands", () => {
  assert.deepEqual(parseInbound("HELP"), { kind: "help" });
  assert.deepEqual(parseInbound("balance"), { kind: "balance" });
  assert.deepEqual(parseInbound("STATUS TXN-abc123"), { kind: "status", reference: "TXN-abc123" });
  assert.deepEqual(parseInbound("stop"), { kind: "stop" });
});

test("typo tolerance (edit distance ≤ 1)", () => {
  assert.equal(parseInbound("BALACE").kind, "balance");
  assert.equal(parseInbound("HLP").kind, "help");
  assert.equal(parseInbound("STTUS TXN-1").kind, "status");
});

test("prefix matching", () => {
  assert.equal(parseInbound("BAL").kind, "balance"); // exact alias
  assert.equal(parseInbound("STATU TXN-9").kind, "status");
});

test("transactional verbs recognized but unsupported", () => {
  const r = parseInbound("PAY 5000");
  assert.equal(r.kind, "unsupported_transactional");
});

test("unknown input never guesses", () => {
  const r = parseInbound("XYZZY please send money");
  assert.equal(r.kind, "unknown");
  assert.equal(parseInbound("").kind, "unknown");
  assert.equal(parseInbound("STATUS").kind, "unknown", "status without reference must not guess");
});

test("HELP text documents the USSD alternative", () => {
  assert.match(HELP_TEXT, /\*384\*100#/);
});

test("matchVerb fails closed for distant tokens", () => {
  assert.equal(matchVerb("ZZZZZZ"), null);
});
