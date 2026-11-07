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

/* ═════════════════════ Styled workbooks + reader (6-nov-2026) ═════════════════════
   «Productos y precios» exports a professional workbook (cover, one sheet per
   section, two-row header in each store's color, money/percent formats, frozen
   panes, autofilter, merged cells) AND reads the same file back to import it.
   `downloadXlsx(name, sheets)` above is untouched: every other caller keeps its
   simple one-header-row sheets. The rich path below is opt-in:

     buildStyledXlsx([{ name, cols:[{ width, hidden }], rows:[{ height, cells:[cell|null] }],
                        merges:["A2:A3"], freeze:{ row: 3, col: 4 }, autoFilter:"A3:K40" }])
       cell = { v: string|number|null, f?: "B4*(1-C4)", s?: { bold, size, color, fill,
                numFmt: "money"|"pct"|"int", align, border, italic, wrap } }
     downloadBytes(filename, bytes)
     readXlsx(bytes) → Promise<[{ name, rows: [[value]] }]>   (values only; styles ignored)

   Colors are "#RRGGBB". `inkOn(hex)` picks white or dark text for a fill. */

/** Readable text on a fill: dark ink on light colors, white on dark ones (WCAG luminance). */
export function inkOn(hex) {
  const c = /^#?[0-9a-f]{6}$/i.test(hex || "") ? String(hex).replace("#", "") : "4F5BD5";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? "#111827" : "#FFFFFF";
}

/** `hex` mixed with white: `amount` 0 = the color, 1 = white. For soft header tints. */
export function tint(hex, amount = 0.8) {
  const c = /^#?[0-9a-f]{6}$/i.test(hex || "") ? String(hex).replace("#", "") : "4F5BD5";
  const mix = (i) => Math.round(parseInt(c.slice(i, i + 2), 16) + (255 - parseInt(c.slice(i, i + 2), 16)) * amount);
  return `#${[0, 2, 4].map((i) => mix(i).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

const argb = (hex) => `FF${String(hex || "#000000").replace("#", "").toUpperCase().padStart(6, "0").slice(0, 6)}`;
const NUMFMT = { money: { id: 166, code: "$#,##0.00" }, pct: { id: 167, code: "0.0%" }, int: { id: 1, code: null } };

/** Dynamic styles.xml: every distinct cell style becomes one cellXfs entry. */
function styleRegistry() {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const seen = new Map([["{}", 0]]);
  const idx = (list, x) => { const i = list.indexOf(x); if (i >= 0) return i; list.push(x); return list.length - 1; };
  const thin = '<border><left style="thin"><color rgb="FFD5D9E2"/></left><right style="thin"><color rgb="FFD5D9E2"/></right><top style="thin"><color rgb="FFD5D9E2"/></top><bottom style="thin"><color rgb="FFD5D9E2"/></bottom><diagonal/></border>';
  return {
    id(s) {
      if (!s) return 0;
      const k = JSON.stringify(s);
      if (seen.has(k)) return seen.get(k);
      const font = `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}<sz val="${s.size || 11}"/>${s.color ? `<color rgb="${argb(s.color)}"/>` : ""}<name val="Calibri"/></font>`;
      const fontId = idx(fonts, font);
      const fillId = s.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const borderId = s.border ? idx(borders, thin) : 0;
      const nf = NUMFMT[s.numFmt]?.id ?? 0;
      const align = s.align || s.wrap ? `<alignment${s.align ? ` horizontal="${s.align}"` : ""} vertical="center"${s.wrap ? ' wrapText="1"' : ""}/>` : "";
      const xf = `<xf numFmtId="${nf}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${nf ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
      xfs.push(xf);
      seen.set(k, xfs.length - 1);
      return xfs.length - 1;
    },
    xml() {
      const fmts = Object.values(NUMFMT).filter((f) => f.code);
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${fmts.length}">${fmts.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${xml(f.code)}"/>`).join("")}</numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    },
  };
}

/** "C4" → { c: 2, r: 4 }. */
export const parseRef = (ref) => {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref || ""));
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { c: c - 1, r: Number(m[2]) };
};
export { colName };

function styledCell(ref, cell, reg) {
  if (!cell) return "";
  const s = reg.id(cell.s);
  const sAttr = s ? ` s="${s}"` : "";
  const v = cell.v;
  const isNum = typeof v === "number" && Number.isFinite(v);
  if (cell.f) return `<c r="${ref}"${sAttr}><f>${xml(cell.f)}</f>${isNum ? `<v>${v}</v>` : ""}</c>`;
  if (v == null || v === "") return s ? `<c r="${ref}"${sAttr}/>` : "";
  if (isNum) return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${sAttr}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}

function styledSheetXml(sheet, reg) {
  const rows = sheet.rows || [];
  const width = Math.max(1, sheet.cols?.length || 0, ...rows.map((r) => (r?.cells || []).length));
  const cols = (sheet.cols || []).map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 12}" customWidth="1"${c.hidden ? ' hidden="1"' : ""}/>`).join("");
  const body = rows.map((r, ri) => {
    const n = ri + 1;
    const cells = (r?.cells || []).map((cell, ci) => styledCell(`${colName(ci)}${n}`, cell, reg)).join("");
    return `<row r="${n}"${r?.height ? ` ht="${r.height}" customHeight="1"` : ""}>${cells}</row>`;
  }).join("");
  const f = sheet.freeze;
  const pane = f && (f.row || f.col)
    ? `<pane${f.col ? ` xSplit="${f.col}"` : ""}${f.row ? ` ySplit="${f.row}"` : ""} topLeftCell="${colName(f.col || 0)}${(f.row || 0) + 1}" activePane="${f.row && f.col ? "bottomRight" : f.row ? "bottomLeft" : "topRight"}" state="frozen"/>`
    : "";
  const merges = (sheet.merges || []).length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(width - 1)}${Math.max(1, rows.length)}"/><sheetViews><sheetView workbookViewId="0"${sheet.gridlines === false ? ' showGridLines="0"' : ""}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${body}</sheetData>${sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : ""}${merges}</worksheet>`;
}

/** The .xlsx bytes of a styled workbook (see the block comment above). */
export function buildStyledXlsx(sheets) {
  const reg = styleRegistry();
  const list = sheets.map((s, i) => ({ ...s, name: safeSheetName(s.name, i) }));
  const sheetXmls = list.map((s) => styledSheetXml(s, reg));
  // Hidden autofilter ranges need the _FilterDatabase defined name or Excel drops them on save.
  const names = list.map((s, i) => (s.autoFilter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(s.name).replace(/'/g, "''")}'!${s.autoFilter.split(":").map((r) => { const p = parseRef(r); return p ? `$${colName(p.c)}$${p.r}` : r; }).join(":")}</definedName>` : "")).join("");
  return zipStore([
    { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${names ? `<definedNames>${names}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", text: reg.xml() },
    ...sheetXmls.map((text, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text })),
  ]);
}

/** Browser download of already-built bytes (styled workbook or any other file). */
export function downloadBytes(filename, bytes, type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─────────────── Reader ───────────────
   Enough of the format to read back what this panel writes AND what Excel /
   LibreOffice / Google Sheets save after the owner edits it: zip entries with
   STORE or DEFLATE (via DecompressionStream "deflate-raw", available in every
   current browser and in Node ≥ 18), shared strings, inline strings, numbers,
   booleans and cached formula values. Styles, merges and formulas are ignored:
   the import only needs the values. */

const dec = new TextDecoder();
const rd16 = (b, o) => b[o] | (b[o + 1] << 8);
const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("xlsx_no_inflate");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** { "xl/workbook.xml": Uint8Array, … } from the zip's central directory. */
export async function unzip(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (rd32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("xlsx_not_zip");
  const count = rd16(b, eocd + 10);
  let p = rd32(b, eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (rd32(b, p) !== 0x02014b50) throw new Error("xlsx_bad_zip");
    const method = rd16(b, p + 10);
    const csize = rd32(b, p + 20);
    const nameLen = rd16(b, p + 28);
    const extraLen = rd16(b, p + 30);
    const commentLen = rd16(b, p + 32);
    const local = rd32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + rd16(b, local + 26) + rd16(b, local + 28);
    const raw = b.subarray(start, start + csize);
    if (method === 0) out[name] = raw;
    else if (method === 8) out[name] = await inflateRaw(raw);
    else throw new Error("xlsx_bad_method");
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unxml = (s) => String(s).replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-f]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === "lt") return "<";
  if (k === "gt") return ">";
  if (k === "quot") return '"';
  if (k === "apos") return "'";
  if (k === "amp") return "&";
  return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});
/** All `<t>` texts inside a fragment, joined (rich-text runs become one string). */
const textOf = (frag) => [...frag.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unxml(m[1]) : null; };

/** Every sheet of the workbook as rows of plain values (string | number | boolean | null), in tab order. */
export async function readXlsx(bytes) {
  const files = await unzip(bytes);
  const text = (name) => (files[name] ? dec.decode(files[name]) : "");
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rels = new Map([...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]));
  const sheets = [];
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name");
    const target = rels.get(attr(m[0], "r:id")) || "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const rows = [];
    for (const rm of text(path).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rn = Number(attr(`<row ${rm[1]}>`, "r")) || rows.length + 1;
      const row = [];
      for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = `<c ${cm[1]}>`;
        const ref = parseRef(attr(head, "r"));
        const ci = ref ? ref.c : row.length;
        const type = attr(head, "t");
        const inner = cm[2] || "";
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        let v = null;
        if (type === "s") v = vm ? shared[Number(vm[1])] ?? null : null;
        else if (type === "inlineStr") v = textOf(inner);
        else if (type === "str") v = vm ? unxml(vm[1]) : null;
        else if (type === "b") v = vm ? vm[1] === "1" : null;
        else if (type === "e") v = null;
        else if (vm) { const n = Number(vm[1]); v = Number.isFinite(n) ? n : unxml(vm[1]); }
        row[ci] = v;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
      rows[rn - 1] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name, rows });
  }
  return sheets;
}
