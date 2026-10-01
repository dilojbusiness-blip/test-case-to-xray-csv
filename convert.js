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

const cell = (row, idx) => (idx >= 0 ? (row[idx] ?? "").trim() : "");

// A new test starts when the name cell is non-empty and differs from the current test's name.
export function groupTests(dataRows, mapping) {
  const tests = [];
  const warnings = [];
  let current = null;

  dataRows.forEach((row, i) => {
    const name = cell(row, mapping.name);
    const step = cell(row, mapping.step);
    const data = cell(row, mapping.data);
    const expected = cell(row, mapping.expected);

    if (name && (!current || name !== current.name)) {
      current = {
        id: `T${tests.length + 1}`,
        name,
        labels: cell(row, mapping.labels),
        priority: cell(row, mapping.priority),
        description: cell(row, mapping.description),
        steps: [],
      };
      tests.push(current);
    }
    if (!current) {
      warnings.push(`Row ${i + 2}: no test name above it, skipped.`);
      return;
    }
    if (step || data || expected) {
      current.steps.push({ action: step, data, expected });
    }
  });

  for (const t of tests) {
    if (t.steps.length === 0) warnings.push(`"${t.name}" has no steps.`);
    if (t.steps.some((s) => !s.action)) warnings.push(`"${t.name}" has a step with an empty action (Xray requires one).`);
  }
  return { tests, warnings };
}

export const OUTPUT_HEADERS = ["Test ID", "Summary", "Test Type", "Labels", "Priority", "Description", "Action", "Data", "Expected Result"];

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
