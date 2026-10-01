// Maps a spreadsheet of test steps to Xray's "one row per step, grouped by Test ID" CSV layout.

export const FIELDS = [
  { key: "name", label: "Test name", required: true, hints: ["test case name", "test name", "test case", "title", "summary", "name", "test"] },
  { key: "step", label: "Step / Action", required: true, hints: ["step description", "action", "steps", "step"] },
  { key: "data", label: "Test data", required: false, hints: ["test data", "data", "input"] },
  { key: "expected", label: "Expected result", required: false, hints: ["expected result", "expected", "result"] },
  { key: "labels", label: "Labels", required: false, hints: ["labels", "label", "tags", "tag"] },
  { key: "priority", label: "Priority", required: false, hints: ["priority"] },
  { key: "description", label: "Description", required: false, hints: ["description", "precondition", "preconditions"] },
];

const norm = (s) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

// Returns { fieldKey: columnIndex | -1 } using exact header match first, then substring.
export function guessMapping(headers) {
  const normalized = headers.map(norm);
  const used = new Set();
  const mapping = {};
  for (const field of FIELDS) {
    let idx = -1;
    for (const hint of field.hints) {
      idx = normalized.findIndex((h, i) => !used.has(i) && h === hint);
      if (idx !== -1) break;
    }
    if (idx === -1) {
      for (const hint of field.hints) {
        idx = normalized.findIndex((h, i) => !used.has(i) && h.includes(hint));
        if (idx !== -1) break;
      }
    }
    if (idx !== -1) used.add(idx);
    mapping[field.key] = idx;
  }
  return mapping;
}

const cell = (row, idx) => (idx >= 0 ? String(row[idx] ?? "") : "");

// A non-empty name starts a new test, even if it repeats the previous name.
// Continuation step rows must have a blank name cell.
export function groupTests(dataRows, mapping) {
  const tests = [];
  const warnings = [];
  const errors = [];
  let current = null;

  dataRows.forEach((row, i) => {
    const name = cell(row, mapping.name).trim();
    const step = cell(row, mapping.step);
    const data = cell(row, mapping.data);
    const expected = cell(row, mapping.expected);

    if (name) {
      current = {
        id: `T${tests.length + 1}`,
        name,
        sourceRow: i + 1,
        labels: cell(row, mapping.labels),
        priority: cell(row, mapping.priority),
        description: cell(row, mapping.description),
        steps: [],
      };
      tests.push(current);
    }
    if (!current) {
      errors.push(`Data row ${i + 1}: no test name above it. Add a name; this row cannot be exported.`);
      return;
    }
    if (!name) {
      for (const key of ["labels", "priority", "description"]) {
        const value = cell(row, mapping[key]);
        if (value.trim() && value !== current[key]) {
          errors.push(`Data row ${i + 1}: ${key} differs from the first row. Move it to the test's first row or give this row a test name.`);
        }
      }
    }
    if (step.trim() || data.trim() || expected.trim()) {
      current.steps.push({ action: step, data, expected, sourceRow: i + 1 });
    }
  });
  return { tests, warnings, errors };
}

export const OUTPUT_HEADERS = ["Test ID", "Summary", "Test Type", "Labels", "Priority", "Description", "Action", "Data", "Expected Result"];

// Zephyr's importer has its own column-mapping step, so these names only need to be recognisable.
export const ZEPHYR_HEADERS = ["Name", "Objective", "Priority", "Labels", "Step", "Test Data", "Expected Result"];

export function buildZephyrRows(tests) {
  const rows = [];
  for (const t of tests) {
    const steps = t.steps.length ? t.steps : [{ action: "", data: "", expected: "" }];
    steps.forEach((s, i) => {
      const first = i === 0;
      rows.push([first ? t.name : "", first ? t.description : "", first ? t.priority : "", first ? t.labels : "", s.action, s.data, s.expected]);
    });
  }
  return rows;
}

export function buildXrayRows(tests, testType = "Manual") {
  const rows = [];
  for (const t of tests) {
    const steps = t.steps.length ? t.steps : [{ action: "", data: "", expected: "" }];
    steps.forEach((s, i) => {
      const first = i === 0;
      rows.push([
        t.id,
        first ? t.name : "",
        first ? testType : "",
        first ? t.labels : "",
        first ? t.priority : "",
        first ? t.description : "",
        s.action,
        s.data,
        s.expected,
      ]);
    });
  }
  return rows;
}
