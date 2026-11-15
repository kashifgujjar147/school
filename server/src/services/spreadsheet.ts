import ExcelJS from 'exceljs';

/** Reads the first worksheet of an .xlsx or a .csv buffer into header-keyed rows. */
/**
 * Plain text of a cell. Date cells (Excel dates) become YYYY-MM-DD: Excel stores calendar dates without
 * a time zone and exceljs exposes them at UTC midnight, so the UTC parts are the date the user typed.
 * (cell.text would give "Tue Mar 06 2012 00:00:00 GMT+0500 …", which no date field accepts.)
 */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(cell.text ?? '').trim();
}

export async function readTable(buf: Buffer, filename: string): Promise<Record<string, string>[]> {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    const { Readable } = await import('node:stream');
    // Keep every CSV value exactly as written. exceljs' default mapper turns "2012-03-06" into a local
    // Date (breaking YYYY-MM-DD validation) and "03001234567" into a number (dropping the leading 0).
    // Strip a UTF-8 BOM so the first header ("admissionNumber") still matches when Excel saved the file.
    const text = buf.toString('utf8').replace(/^﻿/, '');
    await wb.csv.read(Readable.from([text]), { map: (value: unknown) => value });
  } else {
    // exceljs declares its input as an ArrayBuffer; pass an exact-length copy (uploads are capped at 5 MB).
    await wb.xlsx.load(new Uint8Array(buf).buffer);
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell((c, i) => { headers[i] = String(c.text ?? '').trim(); });
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r: Record<string, string> = {};
    let any = false;
    headers.forEach((hName, i) => {
      if (!hName) return;
      const v = cellText(row.getCell(i));
      if (v) any = true;
      r[hName] = v;
    });
    if (any) rows.push(r);
  });
  return rows;
}

export async function toXlsx(sheetName: string, columns: { header: string; key: string; width?: number }[], rows: Record<string, unknown>[], title?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'School Management System';
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  let start = 1;
  if (title) {
    ws.addRow([title]).font = { bold: true, size: 14 };
    ws.addRow([]);
    start = 3;
  }
  ws.getRow(start).values = columns.map((c) => c.header);
  ws.getRow(start).font = { bold: true };
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 2); });
  for (const r of rows) ws.addRow(columns.map((c) => r[c.key] ?? ''));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** RFC 4180 CSV with formula-injection protection (cells starting with = + - @ are prefixed). */
export function toCsv(columns: { header: string; key: string }[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columns.map((c) => esc(c.header)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
}
