import { toCsv } from "../csv.js";
import { buildXrayRows, OUTPUT_HEADERS, buildZephyrRows, ZEPHYR_HEADERS } from "../convert.js";
import { parseFeature, buildTests } from "./gherkin.js";
import { inspectTests, splitTests, XRAY_BATCH_SIZE } from "../preflight.js";

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 2 * 1024 * 1024;
const PREVIEW_ROWS = 200;

const SAMPLE = `@login @smoke
Feature: Login

  Background:
    Given the login page is open

  Scenario: Valid login
    When I sign in as "user1" with password "Passw0rd!"
    Then the dashboard is displayed

  Scenario Outline: Invalid login
    When I sign in as "<user>" with password "<password>"
    Then I see the message "<message>"

    Examples:
      | user  | password | message             |
      | user1 | wrong    | Invalid credentials |
      |       | Passw0rd | Username required   |
`;

let output = "";
let headers = OUTPUT_HEADERS;
let batches = [];
let ready = false;
let loadVersion = 0;

function reset() {
  output = "";
  ready = false;
  batches = [];
  $("download").disabled = true;
  $("step2").hidden = true;
  $("preview").replaceChildren();
  $("warnings").replaceChildren();
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = !msg;
  $("source").setAttribute("aria-invalid", String(Boolean(msg)));
}

function update() {
  loadVersion++;
  reset();
  const text = $("source").value;
  if (new Blob([text]).size > MAX_BYTES) { showError("Input exceeds 2 MB. Split the source file."); return; }
  if (!text.trim()) {
    $("step2").hidden = true;
    ready = false;
    showError("");
    return;
  }
  try {
    convertText(text);
  } catch (e) {
    reset();
    showError(e.message);
  }
}

function convertText(text) {
  const parsed = parseFeature(text);
  const { tests, warnings: buildWarnings } = buildTests(parsed, {
    expand: $("expand").checked,
    background: $("background").checked,
    mode: $("mode").value,
  });
  if (tests.length === 0) {
    $("step2").hidden = true;
    ready = false;
    showError([...parsed.warnings, ...buildWarnings][0] ?? "Nothing to convert.");
    return;
  }
  showError("");

  const preflight = inspectTests(tests);
  preflight.errors.push(...(parsed.errors ?? []), ...(buildWarnings.length ? buildWarnings : []));
  const warnings = [...parsed.warnings, ...buildWarnings, ...preflight.warnings];
  batches = splitTests(tests);
  ready = preflight.errors.length === 0;
  $("source").setAttribute("aria-invalid", String(!ready));
  const zephyr = $("outFormat").value === "zephyr";
  headers = zephyr ? ZEPHYR_HEADERS : OUTPUT_HEADERS;
  const batchSelect = $("batch");
  const selected = Number(batchSelect.value) || 0;
  batchSelect.replaceChildren(...batches.map((batch, i) =>
    new Option(`Part ${i + 1} of ${batches.length} (tests ${i * XRAY_BATCH_SIZE + 1}–${i * XRAY_BATCH_SIZE + batch.length})`, String(i))));
  batchSelect.value = String(Math.min(selected, batches.length - 1));
  $("batchChoice").hidden = batches.length < 2;
  $("download").disabled = !ready;
  renderBatch();

  const stepCount = tests.reduce((n, t) => n + t.steps.length, 0);
  $("summary").textContent = `${tests.length} tests, ${stepCount} steps. ${preflight.errors.length} blocking issues, ${warnings.length} warnings.` + (batches.length > 1 ? ` Download ${batches.length} parts separately (${XRAY_BATCH_SIZE} tests maximum per part).` : "");
  const issues = [...preflight.errors, ...warnings];
  $("warnings").replaceChildren(...issues.slice(0, 20).map((w) => Object.assign(document.createElement("li"), { textContent: w })));
  $("moreIssues").textContent = issues.length > 20 ? `Showing 20 of ${issues.length} issues. Fix the source and check the rest.` : "";
  $("step2").hidden = false;
}

function renderBatch() {
  const tests = batches[Number($("batch").value)] ?? [];
  const zephyr = $("outFormat").value === "zephyr";
  const rows = zephyr ? buildZephyrRows(tests) : buildXrayRows(tests, "Manual");
  output = ready ? toCsv([headers, ...rows], $("outDelim").value) : "";
  const head = document.createElement("tr");
  headers.forEach((h) => head.append(Object.assign(document.createElement("th"), { textContent: h })));
  const body = rows.slice(0, PREVIEW_ROWS).map((r) => {
    const tr = document.createElement("tr");
    r.forEach((c) => tr.append(Object.assign(document.createElement("td"), { textContent: c })));
    return tr;
  });
  $("preview").replaceChildren(head, ...body);
}

async function loadFile(file) {
  if (!file) return;
  const version = ++loadVersion;
  reset();
  $("source").value = "";
  showError("");
  try {
    if (file.size > MAX_BYTES) throw new Error("File is larger than 2 MB. Split it and try again.");
    if (!/\.(feature|txt)$/i.test(file.name)) throw new Error("Use a .feature or .txt file.");
    const text = await file.text();
    if (version !== loadVersion) return;
    $("source").value = text;
    update();
  } catch (e) {
    if (version === loadVersion) showError(e.message);
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

$("source").addEventListener("input", update);
["outFormat", "outDelim", "mode", "expand", "background"].forEach((id) => $(id).addEventListener("change", update));
$("batch").addEventListener("change", renderBatch);
$("loadSample").addEventListener("click", () => {
  $("source").value = SAMPLE;
  update();
});

$("download").addEventListener("click", () => {
  if (!ready || !output) return;
  const blob = new Blob(["\uFEFF", output], { type: "text/csv;charset=utf-8" });
  const base = $("outFormat").value === "zephyr" ? "gherkin-zephyr-import" : "gherkin-xray-import";
  const suffix = batches.length > 1 ? `-part-${String(Number($("batch").value) + 1).padStart(2, "0")}-of-${String(batches.length).padStart(2, "0")}` : "";
  const name = `${base}${suffix}.csv`;
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name, hidden: true });
  document.body.append(a);
  a.click();
  // Revoking synchronously can abort the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
});
