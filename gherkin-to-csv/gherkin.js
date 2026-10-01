// Pure Gherkin parsing and test building (no DOM), so it can be tested in isolation.

const EXAMPLES = /^(Examples|Scenarios)\s*:/i;
const SCENARIO = /^(Scenario Outline|Scenario Template|Scenario|Example)\s*:\s*(.*)$/i;
const FEATURE = /^Feature\s*:\s*(.*)$/i;
const BACKGROUND = /^Background\s*:/i;
const STEP = /^(Given|When|Then|And|But|\*)\s+(.*)$/i;

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

export function parseFeature(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const feature = { name: "", tags: [], background: [], scenarios: [] };
  const warnings = [];

  let pendingTags = [];
  let current = null; // scenario being filled
  let inBackground = false;
  let lastType = "given";
  let lastStep = null;
  let examples = null; // { header, rows }
  let doc = null; // docstring lines being collected

  const target = () => (inBackground ? feature.background : current?.steps);

  for (const raw of lines) {
    const line = raw.trim();

    if (doc) {
      if (line === '"""' || line === "```") {
        if (lastStep) lastStep.data = [lastStep.data, doc.join("\n")].filter(Boolean).join("\n");
        doc = null;
      } else {
        doc.push(line);
      }
      continue;
    }
    if (!line || line.startsWith("#")) continue;

    if (line === '"""' || line === "```") {
      doc = [];
      continue;
    }
    if (line.startsWith("@")) {
      pendingTags.push(...line.split(/\s+/).filter((t) => t.startsWith("@")).map((t) => t.slice(1)));
      continue;
    }

    let m;
    if ((m = line.match(FEATURE))) {
      feature.name = m[1].trim();
      feature.tags = pendingTags;
      pendingTags = [];
      continue;
    }
    if (BACKGROUND.test(line)) {
      inBackground = true;
      current = null;
      examples = null;
      lastStep = null;
      lastType = "given";
      pendingTags = [];
      continue;
    }
    if ((m = line.match(SCENARIO))) {
      inBackground = false;
      examples = null;
      lastStep = null;
      lastType = "given";
      current = {
        name: m[2].trim(),
        outline: /outline|template/i.test(m[1]),
        tags: [...feature.tags, ...pendingTags],
        steps: [],
        examples: [],
      };
      pendingTags = [];
      feature.scenarios.push(current);
      continue;
    }
    if (EXAMPLES.test(line)) {
      if (!current) {
        warnings.push("Examples block found before any scenario; ignored.");
        continue;
      }
      examples = { header: null, rows: [] };
      current.examples.push(examples);
      pendingTags = [];
      continue;
    }
    if (line.startsWith("|")) {
      const cells = splitRow(line);
      if (examples) {
        if (!examples.header) examples.header = cells;
        else examples.rows.push(Object.fromEntries(examples.header.map((h, i) => [h, cells[i] ?? ""])));
      } else if (lastStep) {
        lastStep.data = [lastStep.data, cells.join(" | ")].filter(Boolean).join("\n");
      }
      continue;
    }
    if ((m = line.match(STEP))) {
      const kw = m[1] === "*" ? "*" : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      const lower = kw.toLowerCase();
      if (["given", "when", "then"].includes(lower)) lastType = lower;
      const list = target();
      if (!list) {
        warnings.push(`Step outside a scenario skipped: "${line}"`);
        continue;
      }
      lastStep = { kw, type: lastType, text: m[2].trim(), data: "" };
      list.push(lastStep);
      examples = null;
      continue;
    }
    // Free text (feature description, Rule:, etc.) is ignored on purpose.
  }
  if (doc) warnings.push("A docstring was never closed; its content was ignored.");
  return { feature, warnings };
}

const fill = (s, row) => s.replace(/<([^<>]+)>/g, (m, k) => (k in row ? row[k] : m));

// opts: { expand: bool, background: bool, mode: "each" | "then" }
export function buildTests({ feature }, opts) {
  const tests = [];
  const warnings = [];

  const toSteps = (steps) => {
    if (opts.mode !== "then") return steps.map((s) => ({ action: `${s.kw} ${s.text}`, data: s.data, expected: "" }));
    const out = [];
    for (const s of steps) {
      const prev = out[out.length - 1];
      if (s.type === "then" && prev) {
        prev.expected = [prev.expected, `${s.kw} ${s.text}`].filter(Boolean).join("\n");
        if (s.data) prev.data = [prev.data, s.data].filter(Boolean).join("\n");
      } else {
        out.push({ action: `${s.kw} ${s.text}`, data: s.data, expected: "" });
      }
    }
    return out;
  };

  const add = (name, tags, steps) => {
    tests.push({ id: `T${tests.length + 1}`, name, labels: tags.join(";"), priority: "", description: feature.name, steps: toSteps(steps) });
  };

  for (const sc of feature.scenarios) {
    const steps = [...(opts.background ? feature.background : []), ...sc.steps];
    const rows = sc.examples.flatMap((e) => e.rows);
    if (sc.steps.length === 0) warnings.push(`Scenario "${sc.name}" has no steps.`);

    if (sc.outline && opts.expand) {
      if (rows.length === 0) {
        warnings.push(`Outline "${sc.name}" has no Examples rows; exported once with <placeholders> unchanged.`);
        add(sc.name, sc.tags, steps);
        continue;
      }
      rows.forEach((row, i) => {
        const name = fill(sc.name, row);
        add(name === sc.name ? `${sc.name} (example ${i + 1})` : name, sc.tags, steps.map((s) => ({ ...s, text: fill(s.text, row), data: fill(s.data, row) })));
      });
    } else {
      add(sc.name, sc.tags, steps);
    }
  }
  if (feature.scenarios.length === 0) warnings.push("No Scenario found. Check that the text is a Gherkin feature file.");
  return { tests, warnings };
}
