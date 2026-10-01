// Minimal .xlsx reader (first sheet only): zip -> XML -> rows. No dependencies, no zip64.

const MAX_UNPACKED = 50 * 1024 * 1024;

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNPACKED) {
      await reader.cancel();
      throw new Error("Spreadsheet is too large once unpacked.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This does not look like a valid .xlsx file.");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt .xlsx file.");
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nlen = view.getUint16(p + 28, true);
    const elen = view.getUint16(p + 30, true);
    const clen = view.getUint16(p + 32, true);
    const lho = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { method, csize, lho });
    p += 46 + nlen + elen + clen;
  }

  return async (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.lho + 30 + view.getUint16(e.lho + 26, true) + view.getUint16(e.lho + 28, true);
    const data = bytes.subarray(start, start + e.csize);
    if (e.method === 0) return new TextDecoder().decode(data);
    if (e.method === 8) return inflate(data);
    throw new Error("Unsupported compression in .xlsx file.");
  };
}

const parseXml = (text) => new DOMParser().parseFromString(text, "application/xml");
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function readXlsx(buffer) {
  const read = readZip(buffer);

  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml
    ? [...parseXml(sharedXml).getElementsByTagName("si")].map((si) =>
        [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")
      )
    : [];

  // Resolve the first sheet through workbook.xml and its relationships.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = parseXml(wb).getElementsByTagName("sheet")[0];
    const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = [...parseXml(rels).getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
    if (rel) {
      const target = rel.getAttribute("Target");
      sheetPath = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    }
  }

  const sheetXml = await read(sheetPath);
  if (!sheetXml) throw new Error("Could not find a worksheet in this file.");

  const rows = [];
  for (const rowEl of parseXml(sheetXml).getElementsByTagName("row")) {
    const row = [];
    for (const c of rowEl.getElementsByTagName("c")) {
      const idx = colIndex(c.getAttribute("r") ?? "A1");
      const type = c.getAttribute("t");
      let value = "";
      if (type === "inlineStr") {
        value = [...c.getElementsByTagName("t")].map((t) => t.textContent).join("");
      } else {
        const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        value = type === "s" ? (shared[Number(v)] ?? "") : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
      }
      while (row.length < idx) row.push("");
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}
