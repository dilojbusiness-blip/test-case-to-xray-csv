import { detectDelimiter, parseDelimited, toCsv } from "./csv.js";
import { FIELDS, guessMapping, groupTests, buildXrayRows, OUTPUT_HEADERS, buildZephyrRows, ZEPHYR_HEADERS } from "./convert.js";
import { readXlsx } from "./xlsx.js";

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

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = !msg;
}

function loadText(text) {
  loadRows(parseDelimited(text, detectDelimiter(text)));
}

function loadRows(parsed) {
  showError("");
  if (parsed.length < 2) {
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
  const missing = FIELDS.filter((f) => f.required && mapping[f.key] < 0).map((f) => f.label);
  $("step3").hidden = missing.length > 0;
  if (missing.length) {
    showError(`Choose a column for: ${missing.join(", ")}.`);
    return;
  }
  showError("");

  const { tests, warnings } = groupTests(table.rows, mapping);
  const zephyr = $("outFormat").value === "zephyr";
  $("testType").closest("label").hidden = zephyr;
  headers = zephyr ? ZEPHYR_HEADERS : OUTPUT_HEADERS;
  const outRows = zephyr ? buildZephyrRows(tests) : buildXrayRows(tests, $("testType").value.trim() || "Manual");
  output = toCsv([headers, ...outRows], $("outDelim").value);

  const stepCount = tests.reduce((n, t) => n + t.steps.length, 0);
  $("summary").textContent = `${tests.length} tests, ${stepCount} steps.` + (tests.length > 1000 ? " Xray imports at most 1000 issues per run; split the file." : "");

  const ul = $("warnings");
  ul.replaceChildren(...warnings.slice(0, 20).map((w) => Object.assign(document.createElement("li"), { textContent: w })));

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
  if (file.size > MAX_BYTES) {
    showError("File is larger than 10 MB. Split it and try again.");
    return;
  }
  if (/\.xls$/i.test(file.name)) {
    showError("Old .xls files are not supported. In Excel use Save As > .xlsx or CSV, or paste the cells below.");
    return;
  }
  if (/\.xlsx$/i.test(file.name)) {
    try {
      loadRows(await readXlsx(await file.arrayBuffer()));
    } catch (e) {
      showError(`Could not read this Excel file (${e.message}). Try Save As CSV, or paste the cells.`);
    }
    return;
  }
  loadText(await file.text());
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
  else showError("Paste some cells first.");
});
$("loadSample").addEventListener("click", () => {
  $("paste").value = SAMPLE;
  loadText(SAMPLE);
});
$("testType").addEventListener("input", () => table.rows.length && update());
$("outDelim").addEventListener("change", () => table.rows.length && update());
$("outFormat").addEventListener("change", () => table.rows.length && update());

$("download").addEventListener("click", () => {
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(["\uFEFF", output], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: $("outFormat").value === "zephyr" ? "zephyr-import.csv" : "xray-import.csv", hidden: true });
  document.body.append(a);
  a.click();
  // Revoking synchronously can abort the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
});
