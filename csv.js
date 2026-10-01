// Pure functions: no DOM access, so they can be tested in isolation.

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = { "\t": 0, ",": 0, ";": 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

// RFC 4180 style parser: quoted fields may contain delimiters, quotes ("") and newlines.
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        field += ch;
      }
    } else if (closedQuote && ch !== delimiter && ch !== "\n" && ch !== "\r") {
      throw new Error("Unexpected text after a closing quote. Check the CSV quoting.");
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === '"') {
      throw new Error("Quote inside an unquoted cell. Enclose the entire cell in quotes.");
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
      closedQuote = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error("Unclosed quoted cell. No data was converted.");
  if (field !== "" || row.length > 0 || closedQuote) {
    row.push(field);
    rows.push(row);
  }
  const nonempty = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  const width = nonempty[0]?.length;
  const mismatch = nonempty.findIndex((r) => r.length !== width);
  if (mismatch >= 0) throw new Error(`Record ${mismatch + 1} has ${nonempty[mismatch].length} cells; expected ${width}. Check the delimiter and quoting.`);
  return nonempty;
}

export function toCsv(rows, delimiter = ",") {
  const needsQuote = new RegExp(`["\\r\\n${delimiter === "\t" ? "\\t" : delimiter}]`);
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(delimiter)
    )
    .join("\r\n");
}
