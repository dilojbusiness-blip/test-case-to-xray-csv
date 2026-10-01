import { toCsv } from "../csv.js";
import { buildXrayRows, OUTPUT_HEADERS, buildZephyrRows, ZEPHYR_HEADERS } from "../convert.js";
import { parseFeature, buildTests } from "./gherkin.js";

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

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = !msg;
}

function update() {
  const text = $("source").value;
  if (!text.trim()) {
    $("step2").hidden = true;
    return;
  }
  const parsed = parseFeature(text);
  const { tests, warnings } = buildTests(parsed, {
    expand: $("expand").checked,
    background: $("background").checked,
    mode: $("mode").value,
  });
  if (tests.length === 0) {
    $("step2").hidden = true;
    showError(warnings[0] ?? "Nothing to convert.");
    return;
  }
  showError("");

  const zephyr = $("outFormat").value === "zephyr";
  headers = zephyr ? ZEPHYR_HEADERS : OUTPUT_HEADERS;
  const rows = zephyr ? buildZephyrRows(tests) : buildXrayRows(tests, "Manual");
  output = toCsv([headers, ...rows], $("outDelim").value);

  const stepCount = tests.reduce((n, t) => n + t.steps.length, 0);
  $("summary").textContent = `${tests.length} tests, ${stepCount} steps.` + (tests.length > 1000 ? " Xray imports at most 1000 issues per run; split the file." : "");
  $("warnings").replaceChildren(...warnings.slice(0, 20).map((w) => Object.assign(document.createElement("li"), { textContent: w })));

  const head = document.createElement("tr");
  headers.forEach((h) => head.append(Object.assign(document.createElement("th"), { textContent: h })));
  const body = rows.slice(0, PREVIEW_ROWS).map((r) => {
    const tr = document.createElement("tr");
    r.forEach((c) => tr.append(Object.assign(document.createElement("td"), { textContent: c })));
    return tr;
  });
  $("preview").replaceChildren(head, ...body);
  $("step2").hidden = false;
}

async function loadFile(file) {
  if (!file) return;
  if (file.size > MAX_BYTES) {
    showError("File is larger than 2 MB. Split it and try again.");
    return;
  }
  $("source").value = await file.text();
  update();
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
$("loadSample").addEventListener("click", () => {
  $("source").value = SAMPLE;
  update();
});

$("download").addEventListener("click", () => {
  const blob = new Blob(["\uFEFF", output], { type: "text/csv;charset=utf-8" });
  const name = $("outFormat").value === "zephyr" ? "gherkin-zephyr-import.csv" : "gherkin-xray-import.csv";
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name, hidden: true });
  document.body.append(a);
  a.click();
  // Revoking synchronously can abort the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
});
