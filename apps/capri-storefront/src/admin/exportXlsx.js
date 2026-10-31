// Excel export without dependencies: a minimal .xlsx writer (one or more sheets,
// inline strings, numbers kept as numbers, dates as ISO text, column widths).
// An .xlsx is a zip of XML parts; we write the zip ourselves (STORE method, no
// compression) so the panel needs no library. Good for reports of a few
// thousand rows — the files Excel opens, sorts and sums without a "repair".
//
// Usage: downloadXlsx("ventas-2026-10.xlsx", [{ name: "Ventas", cols: [{ header, key, width?, type? }], rows }])
//   type: "money" (0.00), "int", "pct" (0.0%), "date" (text, ISO), "text" (default)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const enc = new TextEncoder();
const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

/** Zip of [{ name, text }] entries, STORE method. Returns a Uint8Array. */
export function zipStore(entries) {
  const now = new Date();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, text } of entries) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const head = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime(now)), ...u16(dosDate(now)),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0),
    ]);
    parts.push(head, nameB, data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime(now)), ...u16(dosDate(now)),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]), nameB);
    offset += head.length + nameB.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const total = offset + cdSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of [...parts, ...central, end]) { out.set(b, p); p += b.length; }
  return out;
}

const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
// Cell styles (index into cellXfs): 0 text, 1 bold header, 2 money, 3 int, 4 pct, 5 bold money (totals)
const STYLE = { text: 0, header: 1, money: 2, int: 3, pct: 4, total: 5 };
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF5"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const cellXml = (ref, value, type, bold) => {
  if (value == null || value === "") return "";
  const num = typeof value === "number" && Number.isFinite(value);
  if ((type === "money" || type === "int" || type === "pct" || type === "number") && (num || (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))))) {
    const v = num ? value : Number(value);
    const s = type === "money" ? (bold ? STYLE.total : STYLE.money) : type === "int" ? STYLE.int : type === "pct" ? STYLE.pct : STYLE.text;
    return `<c r="${ref}" s="${s}"><v>${type === "pct" ? v / 100 : v}</v></c>`;
  }
  if (num) return `<c r="${ref}" s="${bold ? STYLE.header : STYLE.text}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${bold ? STYLE.header : STYLE.text}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
};

/**
 * sheet = { name, cols: [{ header, key | get(row), width?, type? }], rows: [...], totals?: { key: value } }
 * `totals` adds a bold last row (label in the first column when it has no value).
 */
function sheetXml(sheet) {
  const cols = sheet.cols;
  const widths = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || Math.max(10, Math.min(48, String(c.header).length + 4))}" customWidth="1"/>`).join("");
  const rows = [];
  rows.push(`<row r="1">${cols.map((c, i) => cellXml(`${colName(i)}1`, c.header, "text", true)).join("")}</row>`);
  sheet.rows.forEach((r, ri) => {
    const cells = cols.map((c, i) => cellXml(`${colName(i)}${ri + 2}`, typeof c.get === "function" ? c.get(r) : r[c.key], c.type || "text", false)).join("");
    rows.push(`<row r="${ri + 2}">${cells}</row>`);
  });
  if (sheet.totals) {
    const rn = sheet.rows.length + 2;
    const cells = cols.map((c, i) => {
      const v = c.key != null ? sheet.totals[c.key] : undefined;
      if (i === 0 && v == null) return cellXml(`${colName(i)}${rn}`, sheet.totalsLabel || "Total", "text", true);
      return cellXml(`${colName(i)}${rn}`, v, c.type || "text", true);
    }).join("");
    rows.push(`<row r="${rn}">${cells}</row>`);
  }
  const last = `${colName(cols.length - 1)}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${rows.join("")}</sheetData><autoFilter ref="A1:${colName(cols.length - 1)}${Math.max(1, sheet.rows.length + 1)}"/></worksheet>`;
}

const safeSheetName = (s, i) => String(s || `Hoja${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31);

/** Build the .xlsx bytes for one or more sheets. */
export function buildXlsx(sheets) {
  const list = sheets.map((s, i) => ({ ...s, name: safeSheetName(s.name, i) }));
  const entries = [
    { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", text: STYLES_XML },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ];
  return zipStore(entries);
}

/** Trigger a browser download of the workbook. */
export function downloadXlsx(filename, sheets) {
  const bytes = buildXlsx(sheets);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
