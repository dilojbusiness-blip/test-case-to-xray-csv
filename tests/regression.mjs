import test from "node:test";
import assert from "node:assert/strict";
import { detectDelimiter, parseDelimited, toCsv } from "../csv.js";
import { guessMapping, groupTests, buildXrayRows, buildZephyrRows, OUTPUT_HEADERS } from "../convert.js";
import { inspectTests, inspectMapping, splitTests } from "../preflight.js";
import { parseFeature, buildTests } from "../gherkin-to-csv/gherkin.js";

const options = { expand: true, background: true, mode: "then" };
const mapping = { name: 0, step: 1, data: 2, expected: 3, labels: -1, priority: -1, description: -1 };
const valid = (id = "T1") => ({ id, name: `Test ${id}`, labels: "", priority: "", description: "", steps: [{ action: "Act", data: "", expected: "Done" }] });

test("CSV round-trips commas, quotes, Unicode, multiline and significant whitespace", () => {
  const rows = [["Name", "Action"], ["नमस्ते", '  click "yes", then\ncontinue  ']];
  assert.deepEqual(parseDelimited(toCsv(rows), ","), rows);
  assert.equal(detectDelimiter('Name;Action\r\nA;B'), ";");
  assert.equal(detectDelimiter('Name\tAction\nA\tB'), "\t");
  assert.deepEqual(parseDelimited('\uFEFFName,Action\r\nA,B\r\n', ","), [["Name", "Action"], ["A", "B"]]);
});

test("malformed CSV is rejected instead of losing records", () => {
  for (const input of ['Name,Action\nA,"unclosed', 'Name,Action\nA,B,C', 'Name,Action\nA,"b"oops', 'Name,Action\nA,b"c']) {
    assert.throws(() => parseDelimited(input, ","));
  }
});

test("grouping preserves all steps and repeated names create separate tests", () => {
  const grouped = groupTests([["Same", " Step 1 ", " x ", ""], ["", "Step 2", "", ""], ["Same", "Step 3", "", ""]], mapping);
  assert.equal(grouped.tests.length, 2);
  assert.equal(grouped.tests[0].steps.length, 2);
  assert.equal(grouped.tests[0].steps[0].action, " Step 1 ");
  assert.equal(grouped.tests[0].steps[0].data, " x ");
  assert.equal(inspectTests(grouped.tests).warnings.length, 1);
});

test("orphan rows and conflicting continuation metadata block export", () => {
  assert.equal(groupTests([["", "Action", "", ""]], mapping).errors.length, 1);
  const result = groupTests([["Name", "Act", "", "", "smoke"], ["", "Next", "", "", "other"]], { ...mapping, labels: 4 });
  assert.equal(result.errors.length, 1);
});

test("missing names, actions and steps fail preflight", () => {
  const t = valid();
  t.name = " "; t.steps[0].action = " ";
  assert.equal(inspectTests([t]).errors.length, 2);
  assert.equal(inspectTests([{ ...valid(), steps: [] }]).errors.length, 1);
});

test("duplicate mappings block export and header guessing stays unique", () => {
  assert.equal(inspectMapping({ name: 0, step: 0 }, ["Name"]).length, 1);
  const guessed = guessMapping(["Test Case Name", "Step Description", "Test Data", "Expected Result"]);
  assert.deepEqual([guessed.name, guessed.step, guessed.data, guessed.expected], [0, 1, 2, 3]);
});

test("1001 tests split into complete 1000/1 batches without losing steps or IDs", () => {
  const tests = Array.from({ length: 1001 }, (_, i) => valid(`T${i + 1}`));
  tests[999].steps.push({ action: "Second action", data: "", expected: "" });
  const batches = splitTests(tests);
  assert.deepEqual(batches.map(b => b.length), [1000, 1]);
  assert.equal(buildXrayRows(batches[0]).length, 1001);
  assert.equal(buildXrayRows(batches[1])[0][0], "T1001");
  assert.deepEqual(batches.flat(), tests);
  assert.throws(() => splitTests(tests, 0), RangeError);
});

test("Xray and Zephyr exports are structurally valid CSV", () => {
  const rows = buildXrayRows([valid()]);
  assert.equal(rows[0][2], "Manual");
  assert.deepEqual(parseDelimited(toCsv([OUTPUT_HEADERS, ...rows]), ","), [OUTPUT_HEADERS, ...rows]);
  assert.equal(buildZephyrRows([valid()])[0].length, 7);
});

test("Gherkin expands examples, includes Background and preserves tags", () => {
  const parsed = parseFeature('@feature\nFeature: Login\nBackground:\n Given ready\n@scenario\nScenario Outline: User <user>\n When login <user>\n Then done\n@example\nExamples:\n | user |\n | a |\n | b |');
  const result = buildTests(parsed, options);
  assert.equal(result.tests.length, 2);
  assert.equal(result.tests[0].name, "User a");
  assert.equal(result.tests[0].steps.length, 2);
  assert.equal(result.tests[0].steps[1].expected, "Then done");
  assert.equal(result.tests[0].labels, "feature;scenario;example");
});

test("typed docstrings preserve indentation and report unclosed text", () => {
  const parsed = parseFeature('Feature: F\nScenario: S\n Given payload\n  """json\n  {\n    "a": 1\n  }\n  """');
  assert.equal(parsed.feature.scenarios[0].steps[0].data, '{\n  "a": 1\n}');
  assert.equal(parsed.errors.length, 0);
  assert.ok(parseFeature('Feature: F\nScenario: S\n Given payload\n """\nabc').errors.length);
});

test("unsupported Rule/language and broken Examples are flagged", () => {
  assert.ok(parseFeature('Feature: F\nRule: R\nScenario: S\n Given x').errors.length);
  assert.ok(parseFeature('# language: fr\nFonctionnalité: F').errors.length);
  assert.ok(parseFeature('Feature: F\nScenario Outline: S\n Given <a>\nExamples:\n | a | a |\n | x | y |').errors.length);
  assert.ok(parseFeature('Feature: F\nScenario Outline: S\n Given <a>\nExamples:\n | a |\n | x | y |').errors.length);
});

test("empty or unresolved outline examples and empty scenarios prevent a clean preflight", () => {
  const unresolved = buildTests(parseFeature('Feature: F\nScenario Outline: S\n Given <missing>\nExamples:\n | other |\n | value |'), options);
  assert.ok(unresolved.warnings.length);
  const empty = buildTests(parseFeature('Feature: F\nScenario: Empty'), options);
  assert.ok(inspectTests(empty.tests).errors.length);
});

test("formula-like content triggers a warning without changing the test", () => {
  const t = valid();
  t.steps[0].data = "=1+1";
  assert.ok(inspectTests([t]).warnings.some(w => w.includes("formula")));
  assert.equal(buildXrayRows([t])[0][7], "=1+1");
});