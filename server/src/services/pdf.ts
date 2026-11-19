import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { drawableUpload } from './documents.js';

export interface PdfTable {
  title: string;
  subtitle?: string;
  columns: { header: string; key: string; width: number; align?: 'left' | 'right' | 'center' }[];
  rows: Record<string, unknown>[];
  summary?: string[];
}

export interface Branding { schoolName: string; logoPath?: string | null; header?: string | null; footer?: string | null; primaryColor: string }

/**
 * Renders a branded, paginated table report. Fonts: Helvetica by default. For Urdu text set
 * REPORT_FONT_PATH to a TTF with Arabic-script glyphs (e.g. Noto Naskh Arabic); see docs.
 */
export function renderPdf(table: PdfTable, brand: Branding): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const landscape = table.columns.reduce((a, c) => a + c.width, 0) > 520;
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Title: table.title, Author: brand.schoolName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const fontPath = process.env.REPORT_FONT_PATH;
    if (fontPath && existsSync(fontPath)) { doc.registerFont('body', fontPath); doc.font('body'); }

    const pageW = doc.page.width - 72;
    const header = () => {
      const top = 36;
      const logoAbs = drawableUpload(brand.logoPath);
      let x = 36;
      if (logoAbs && existsSync(logoAbs) && !logoAbs.endsWith('.webp')) {
        try { doc.image(logoAbs, 36, top, { fit: [44, 44] }); x = 90; } catch { /* unsupported image */ }
      }
      doc.fillColor(brand.primaryColor).fontSize(15).text(brand.schoolName, x, top, { width: pageW - (x - 36) });
      if (brand.header) doc.fillColor('#555').fontSize(8.5).text(brand.header, x, doc.y, { width: pageW - (x - 36) });
      doc.fillColor('#111').fontSize(12).text(table.title, x, doc.y + 2);
      if (table.subtitle) doc.fillColor('#555').fontSize(8.5).text(table.subtitle, x, doc.y);
      doc.moveTo(36, 92).lineTo(36 + pageW, 92).strokeColor(brand.primaryColor).lineWidth(1).stroke();
      doc.y = 100;
    };
    const scale = pageW / table.columns.reduce((a, c) => a + c.width, 0);
    const colX: number[] = [];
    table.columns.reduce((x, c, i) => { colX[i] = x; return x + c.width * scale; }, 36);
    const drawHeaderRow = () => {
      const y = doc.y;
      doc.rect(36, y - 2, pageW, 16).fill('#eef1f5');
      doc.fillColor('#222').fontSize(8.5);
      table.columns.forEach((c, i) => doc.text(c.header, colX[i]! + 3, y + 2, { width: c.width * scale - 6, align: c.align ?? 'left', lineBreak: false }));
      doc.y = y + 18;
    };
    header();
    drawHeaderRow();
    doc.fontSize(8.5);
    table.rows.forEach((r, idx) => {
      if (doc.y > doc.page.height - 60) { doc.addPage(); header(); drawHeaderRow(); doc.fontSize(8.5); }
      const y = doc.y;
      if (idx % 2) doc.rect(36, y - 2, pageW, 14).fill('#fafbfc');
      doc.fillColor('#111');
      table.columns.forEach((c, i) => doc.text(String(r[c.key] ?? ''), colX[i]! + 3, y, { width: c.width * scale - 6, align: c.align ?? 'left', lineBreak: false, ellipsis: true }));
      doc.y = y + 14;
    });
    if (!table.rows.length) doc.fillColor('#666').text('No records for the selected filters.', 36, doc.y + 6);
    if (table.summary?.length) {
      doc.moveDown();
      doc.fillColor('#111').fontSize(9);
      for (const s of table.summary) doc.text(s, 36);
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#888').fontSize(7.5).text(
        `${brand.footer ? brand.footer + '  ·  ' : ''}Generated ${new Date().toLocaleString('en-GB')}  ·  Page ${i + 1} of ${range.count}`,
        36, doc.page.height - 30, { width: pageW, align: 'center', lineBreak: false }
      );
    }
    doc.end();
  });
}
