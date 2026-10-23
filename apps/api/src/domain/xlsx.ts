import { deflateRawSync } from 'node:zlib';

/** A minimal, dependency-free Excel (.xlsx) writer for admin reports. */
export type XlsxColumn = { header: string; width?: number; type?: 'text' | 'usdt' | 'number' | 'int' | 'date' | 'percent' };
export type XlsxSheet = { name: string; columns: XlsxColumn[]; rows: unknown[][] };

const STYLE = { text: 0, header: 1, usdt: 2, int: 3, date: 4, percent: 5 } as const;

const escapeXml = (value: string) => value
  // XML 1.0 forbids most control characters; drop them rather than emit a corrupt file.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const columnName = (index: number) => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

function cell(ref: string, value: unknown, type: XlsxColumn['type']) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'date') {
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (Number.isFinite(time)) return `<c r="${ref}" s="${STYLE.date}"><v>${time / 86_400_000 + 25_569}</v></c>`;
  }
  if (type === 'usdt' || type === 'int' || type === 'percent') {
    // USDT columns hold atomic units (6 decimals); bigint keeps them exact until here.
    const number = type === 'usdt' ? Number(BigInt(value as bigint | string | number)) / 1_000_000 : Number(value);
    if (Number.isFinite(number)) return `<c r="${ref}" s="${STYLE[type]}"><v>${number}</v></c>`;
  }
  if (!type && (typeof value === 'number' || typeof value === 'bigint')) return `<c r="${ref}"><v>${Number(value)}</v></c>`;
  if (type === 'number' && Number.isFinite(Number(value))) return `<c r="${ref}" s="${STYLE.usdt}"><v>${Number(value)}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet) {
  const lastColumn = columnName(Math.max(0, sheet.columns.length - 1));
  const header = `<row r="1">${sheet.columns.map((column, i) => `<c r="${columnName(i)}1" t="inlineStr" s="${STYLE.header}"><is><t>${escapeXml(column.header)}</t></is></c>`).join('')}</row>`;
  const body = sheet.rows.map((row, r) => `<row r="${r + 2}">${sheet.columns.map((column, c) => cell(`${columnName(c)}${r + 2}`, row[c], column.type)).join('')}</row>`).join('');
  const cols = sheet.columns.map((column, i) => `<col min="${i + 1}" max="${i + 1}" width="${column.width ?? 16}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${header}${body}</sheetData>
${sheet.rows.length ? `<autoFilter ref="A1:${lastColumn}${sheet.rows.length + 1}"/>` : ''}</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2A44"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="6"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Buffer) => {
  let crc = 0xFFFFFFFF;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

function zip(files: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), compressed = deflateRawSync(file.data), crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(file.data.length, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); central.push(header, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function buildXlsx(sheets: XlsxSheet[]) {
  // Sheet names: max 31 chars, no []:*?/\ and unique.
  const names = sheets.map((sheet, i) => sheet.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Sheet${i + 1}`);
  const file = (name: string, text: string) => ({ name, data: Buffer.from(text, 'utf8') });
  return zip([
    file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    file('xl/styles.xml', STYLES),
    ...sheets.map((sheet, i) => file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet))),
  ]);
}
