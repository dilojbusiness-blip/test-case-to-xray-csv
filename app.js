import { detectDelimiter, parseDelimited, toCsv } from "./csv.js";
import { FIELDS, guessMapping, groupTests, buildXrayRows, OUTPUT_HEADERS, buildZephyrRows, ZEPHYR_HEADERS } from "./convert.js";
import { readXlsx } from "./xlsx.js";
import { inspectTests, inspectMapping, splitTests, XRAY_BATCH_SIZE } from "./preflight.js";

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 10 * 1024 * 1024;
const PREVIEW_ROWS = 200;

const SAMPLE = `Test Case Name,Step Description,Test Data,Expected Result,Labels,Priority
Login with valid user,Open the login page,,Login form is shown,smoke,High
,Enter valid username and password,user1 / Passw0rd!,Fields accept input,,
,Click Sign in,,Dashboard is displayed,,
Login with wrong password,Open the login page,,Login form is shown,regression,Medium
,Enter valid username and a wrong password,user1 / wrong,,,
,Click Sign in,,"Error message ""Invalid credentials"" is shown",,
`;

let table = { headers: [], rows: [] };
let mapping = {};
let output = "";
let headers = OUTPUT_HEADERS;
let batches = [];
let ready = false;
let loadVersion = 0;

function reset() {
  table = { headers: [], rows: [] };
  mapping = {};
  ready = false;
  output = "";
  batches = [];
  $("download").disabled = true;
  $("step2").hidden = true;
  $("step3").hidden = true;
  $("preview").replaceChildren();
  $("warnings").replaceChildren();
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = !msg;
  $("paste").setAttribute("aria-invalid", String(Boolean(msg)));
}

function loadText(text) {
  loadVersion++;
  reset();
  try {
    if (new Blob([text]).size > MAX_BYTES) throw new Error("Input exceeds 10 MB. Split it and try again.");
    loadRows(parseDelimited(text, detectDelimiter(text)));
  } catch (e) {
    showError(e.message);
  }
}

function loadRows(parsed) {
  showError("");
  if (parsed.length < 2) {
    reset();
    showError("Need a header row and at least one data row.");
    return;
  }
  table = { headers: parsed[0].map((h) => String(h).trim()), rows: parsed.slice(1) };
  mapping = guessMapping(table.headers);
  renderMapping();
  $("step2").hidden = false;
  update();
}

function renderMapping() {
  const box = $("mapping");
  box.replaceChildren();
  for (const f of FIELDS) {
    const label = document.createElement("label");
    label.textContent = f.label + (f.required ? " (required)" : "");
    const sel = document.createElement("select");
    sel.dataset.key = f.key;
    sel.add(new Option("- not used -", "-1"));
    table.headers.forEach((h, i) => sel.add(new Option(h || `(column ${i + 1})`, String(i))));
    sel.value = String(mapping[f.key]);
    sel.addEventListener("change", () => {
      mapping[f.key] = Number(sel.value);
      update();
    });
    label.append(sel);
    box.append(label);
  }
}

function update() {
  if (!table.rows.length) return;
  ready = false;
  output = "";
  $("download").disabled = true;
  const missing = FIELDS.filter((f) => f.required && !(mapping[f.key] >= 0)).map((f) => f.label);
  $("step3").hidden = missing.length > 0;
  if (missing.length) {
    ready = false;
    showError(`Choose a column for: ${missing.join(", ")}.`);
    return;
  }
  showError("");

  const { tests, warnings, errors } = groupTests(table.rows, mapping);
  const preflight = inspectTests(tests);
  preflight.errors.push(...errors, ...inspectMapping(mapping, table.headers));
  if ($("outFormat").value === "xray" && !$("testType").value.trim()) preflight.errors.push("Enter the manual test type configured in Xray.");
  batches = splitTests(tests);
  ready = tests.length > 0 && preflight.errors.length === 0;
  const zephyr = $("outFormat").value === "zephyr";
  $("testType").closest("label").hidden = zephyr;
  headers = zephyr ? ZEPHYR_HEADERS : OUTPUT_HEADERS;
  $("download").textContent = zephyr ? "Download Zephyr CSV" : "Download Xray CSV";
  $("importHint").textContent = zephyr
    ? "Zephyr Scale output is experimental and has not been checked against a real import. In Zephyr's CSV wizard, map the columns yourself and test a small sample before importing each numbered part."
    : "In Jira: Apps → Xray → Test Case Importer → CSV. Map Test ID, Summary and Test Type, plus the Xray Test Step fields Action, Data and Expected Result. Import each numbered part separately; start with a small sample to verify your instance's mapping. Unmapped source columns are not exported.";
  const batchSelect = $("batch");
  const selected = Number(batchSelect.value) || 0;
  batchSelect.replaceChildren(...batches.map((batch, i) =>
    new Option(`Part ${i + 1} of ${batches.length} (tests ${i * XRAY_BATCH_SIZE + 1}–${i * XRAY_BATCH_SIZE + batch.length})`, String(i))));
  batchSelect.value = String(Math.min(selected, batches.length - 1));
  $("batchChoice").hidden = batches.length < 2;
  $("download").disabled = !ready;
  renderBatch();

  const stepCount = tests.reduce((n, t) => n + t.steps.length, 0);
  $("summary").textContent = `${tests.length} tests, ${stepCount} steps. ${preflight.errors.length} blocking issues, ${warnings.length + preflight.warnings.length} warnings.` + (batches.length > 1 ? ` Download ${batches.length} parts separately (${XRAY_BATCH_SIZE} tests maximum per part).` : "");

  const issues = [...preflight.errors, ...warnings, ...preflight.warnings];
  $("paste").setAttribute("aria-invalid", String(!ready));
  $("warnings").replaceChildren(...issues.slice(0, 20).map((w) => Object.assign(document.createElement("li"), { textContent: w })));
  $("moreIssues").textContent = issues.length > 20 ? `Showing 20 of ${issues.length} issues. Fix the source and reload to check the rest.` : "";
  if (!tests.length) showError("No tests found. Check that a test name appears in the mapped column.");
}

function renderBatch() {
  const tests = batches[Number($("batch").value)] ?? [];
  const zephyr = $("outFormat").value === "zephyr";
  const outRows = zephyr ? buildZephyrRows(tests) : buildXrayRows(tests, $("testType").value.trim() || "Manual");
  output = ready ? toCsv([headers, ...outRows], $("outDelim").value) : "";
  renderPreview(outRows);
}

function renderPreview(rows) {
  const t = $("preview");
  const head = document.createElement("tr");
  headers.forEach((h) => head.append(Object.assign(document.createElement("th"), { textContent: h })));
  const body = rows.slice(0, PREVIEW_ROWS).map((r) => {
    const tr = document.createElement("tr");
    r.forEach((c) => tr.append(Object.assign(document.createElement("td"), { textContent: c })));
    return tr;
  });
  t.replaceChildren(head, ...body);
}

async function loadFile(file) {
  if (!file) return;
  const version = ++loadVersion;
  reset();
  showError("");
  try {
    if (file.size > MAX_BYTES) throw new Error("File exceeds 10 MB. Split it and try again.");
    if (!/\.(xlsx|csv|tsv|txt)$/i.test(file.name)) throw new Error("Use .xlsx, .csv, .tsv or .txt. Old .xls is not supported.");
    let rows;
    if (/\.xlsx$/i.test(file.name)) rows = await readXlsx(await file.arrayBuffer());
    else {
      const text = await file.text();
      rows = parseDelimited(text, detectDelimiter(text));
    }
    if (version === loadVersion) loadRows(rows);
  } catch (e) {
    if (version === loadVersion) showError(`Could not load file: ${e.message}`);
  }
}

$("file").addEventListener("change", (e) => loadFile(e.target.files[0]));
const drop = $("drop");
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  })
);
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  loadFile(e.dataTransfer.files[0]);
});

$("loadPaste").addEventListener("click", () => {
  const v = $("paste").value;
  if (v.trim()) loadText(v);
  else { loadVersion++; reset(); showError("Paste some cells first."); }
});
$("loadSample").addEventListener("click", () => {
  $("paste").value = SAMPLE;
  loadText(SAMPLE);
});
$("testType").addEventListener("input", () => table.rows.length && update());
$("paste").addEventListener("input", () => { loadVersion++; reset(); showError("Input changed. Select Use pasted data to convert it."); });
$("outDelim").addEventListener("change", () => table.rows.length && update());
$("outFormat").addEventListener("change", () => table.rows.length && update());
$("batch").addEventListener("change", renderBatch);

$("download").addEventListener("click", () => {
  if (!ready || !output) return;
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(["\uFEFF", output], { type: "text/csv;charset=utf-8" });
  const base = $("outFormat").value === "zephyr" ? "zephyr-import" : "xray-import";
  const suffix = batches.length > 1 ? `-part-${String(Number($("batch").value) + 1).padStart(2, "0")}-of-${String(batches.length).padStart(2, "0")}` : "";
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${base}${suffix}.csv`, hidden: true });
  document.body.append(a);
  a.click();
  // Revoking synchronously can abort the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
});
