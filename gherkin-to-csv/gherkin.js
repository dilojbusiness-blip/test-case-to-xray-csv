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
  const errors = [];

  let pendingTags = [];
  let current = null; // scenario being filled
  let inBackground = false;
  let lastType = "given";
  let lastStep = null;
  let examples = null; // { header, rows }
  let doc = null; // docstring lines being collected
  let docDelimiter = "";
  let docIndent = 0;
  let featureSeen = false;
  let backgroundSeen = false;

  const target = () => (inBackground ? feature.background : current?.steps);

  for (const raw of lines) {
    const line = raw.trim();

    if (doc) {
      if (line === docDelimiter) {
        if (lastStep) lastStep.data = [lastStep.data, doc.join("\n")].filter(Boolean).join("\n");
        doc = null;
      } else {
        doc.push(raw.slice(Math.min(docIndent, raw.length - raw.trimStart().length)));
      }
      continue;
    }
    if (/^#\s*language\s*:/i.test(line) && !/^#\s*language\s*:\s*en\s*$/i.test(line)) errors.push("Only English Gherkin keywords are supported.");
    if (!line || line.startsWith("#")) continue;

    if (/^("""|```)/.test(line)) {
      if (!lastStep) errors.push("Docstring without a preceding step.");
      doc = [];
      docDelimiter = line.slice(0, 3);
      docIndent = raw.length - raw.trimStart().length;
      continue;
    }
    if (line.startsWith("@")) {
      pendingTags.push(...line.split(/\s+/).filter((t) => t.startsWith("@")).map((t) => t.slice(1)));
      continue;
    }

    let m;
    if ((m = line.match(FEATURE))) {
      if (featureSeen) errors.push("Use one Feature per file.");
      featureSeen = true;
      feature.name = m[1].trim();
      feature.tags = pendingTags;
      pendingTags = [];
      continue;
    }
    if (BACKGROUND.test(line)) {
      if (backgroundSeen || feature.scenarios.length) errors.push("Only one feature-level Background before the scenarios is supported.");
      backgroundSeen = true;
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
        errors.push("Examples block found before any scenario.");
        continue;
      }
      examples = { header: null, rows: [], tags: pendingTags };
      current.examples.push(examples);
      pendingTags = [];
      continue;
    }
    if (line.startsWith("|")) {
      const cells = splitRow(line);
      if (examples) {
        if (!examples.header) {
          examples.header = cells;
          if (cells.some(c => !c) || new Set(cells).size !== cells.length) errors.push("Examples headers must be non-empty and unique.");
        } else if (cells.length !== examples.header.length) errors.push("Examples row has the wrong number of cells.");
        else examples.rows.push(Object.fromEntries(examples.header.map((h, i) => [h, cells[i]])));
      } else if (lastStep) {
        lastStep.data = [lastStep.data, cells.join(" | ")].filter(Boolean).join("\n");
      } else errors.push("Data table without a preceding step or Examples block.");
      continue;
    }
    if ((m = line.match(STEP))) {
      const kw = m[1] === "*" ? "*" : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      const lower = kw.toLowerCase();
      if (["given", "when", "then"].includes(lower)) lastType = lower;
      const list = target();
      if (!list) {
        errors.push(`Step outside a scenario: "${line}"`);
        continue;
      }
      lastStep = { kw, type: lastType, text: m[2].trim(), data: "" };
      list.push(lastStep);
      examples = null;
      continue;
    }
    if (/^Rule\s*:/i.test(line)) errors.push("Rule-scoped Gherkin is not supported. Split rules into separate feature files.");
  }
  if (doc) errors.push("A docstring was never closed.");
  if (!featureSeen) errors.push("A Feature header is required.");
  return { feature, warnings, errors };
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
    if (tests.length >= 10000) throw new Error("Limit is 10000 expanded tests. Split the source file.");
    tests.push({ id: `T${tests.length + 1}`, name, labels: tags.join(";"), priority: "", description: feature.name, steps: toSteps(steps) });
  };

  for (const sc of feature.scenarios) {
    const steps = [...(opts.background ? feature.background : []), ...sc.steps];
    const rows = sc.examples.flatMap((e) => e.rows.map(row => ({ row, tags: e.tags })));
    if (sc.steps.length === 0) warnings.push(`Scenario "${sc.name}" has no steps.`);

    if (sc.outline && opts.expand) {
      if (rows.length === 0) {
        warnings.push(`Outline "${sc.name}" has no Examples rows; exported once with <placeholders> unchanged.`);
        add(sc.name, sc.tags, steps);
        continue;
      }
      rows.forEach(({ row, tags }, i) => {
        const needed = [sc.name, ...steps.flatMap(s => [s.text, s.data])].join("\n").matchAll(/<([^<>]+)>/g);
        for (const match of needed) if (!Object.hasOwn(row, match[1])) warnings.push(`Outline "${sc.name}": missing Examples column "${match[1]}".`);
        const name = fill(sc.name, row);
        add(name === sc.name ? `${sc.name} (example ${i + 1})` : name, [...sc.tags, ...(tags ?? [])], steps.map((s) => ({ ...s, text: fill(s.text, row), data: fill(s.data, row) })));
      });
    } else {
      add(sc.name, sc.tags, steps);
    }
  }
  if (feature.scenarios.length === 0) warnings.push("No Scenario found. Check that the text is a Gherkin feature file.");
  return { tests, warnings };
}
