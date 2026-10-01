// Import preflight and batching shared by both browser-only converters.
export const XRAY_BATCH_SIZE = 1000;
export const MAX_TESTS = 10000;

export function inspectMapping(mapping, headers) {
  const errors = [];
  const used = new Set();
  for (const [field, index] of Object.entries(mapping)) {
    if (index < 0) continue;
    if (!Number.isInteger(index) || index >= headers.length) errors.push(`Invalid column for ${field}.`);
    if (used.has(index)) errors.push(`Column "${headers[index]}" is mapped more than once. Give each field its own column.`);
    used.add(index);
  }
  return errors;
}

export function inspectTests(tests) {
  const errors = [];
  const warnings = [];
  const names = new Map();
  if (tests.length > MAX_TESTS) errors.push(`Limit is ${MAX_TESTS} tests per conversion. Split the source file.`);

  for (const test of tests) {
    const where = test.sourceRow ? `Data row ${test.sourceRow}` : `Test ${test.id}`;
    if (!test.name?.trim()) errors.push(`${where}: test name is empty.`);
    if (!test.steps.length) errors.push(`${where}: no steps; add an action before exporting.`);
    test.steps.forEach((step, i) => {
      if (!step.action?.trim()) {
        const position = step.sourceRow ? `Data row ${step.sourceRow}` : `${where}, step ${i + 1}`;
        errors.push(`${position}: action is empty; enter an action before exporting.`);
      }
    });
    const values = [test.name, test.description, test.labels, test.priority, ...test.steps.flatMap(s => [s.action, s.data, s.expected])];
    if (values.some(v => /^[\s]*[=+@-]/.test(v ?? ""))) warnings.push(`${where}: a cell starts with a spreadsheet formula character. Inspect it as text; opening the CSV in Excel may execute formulas.`);
    if (test.name?.trim()) {
      const first = names.get(test.name.trim());
      if (first) warnings.push(`${where}: repeated test name "${test.name}" (first at ${first}); confirm these are separate tests.`);
      else names.set(test.name.trim(), where);
    }
  }
  return { errors, warnings };
}

export function splitTests(tests, size = XRAY_BATCH_SIZE) {
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError("Batch size must be a positive integer.");
  const batches = [];
  for (let i = 0; i < tests.length; i += size) batches.push(tests.slice(i, i + size));
  return batches;
}