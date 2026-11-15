import ExcelJS from 'exceljs';

/** Reads the first worksheet of an .xlsx or a .csv buffer into header-keyed rows. */
export async function readTable(buf: Buffer, filename: string): Promise<Record<string, string>[]> {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    const { Readable } = await import('node:stream');
    await wb.csv.read(Readable.from(buf));
  } else {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
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
      const v = String(row.getCell(i).text ?? '').trim();
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
