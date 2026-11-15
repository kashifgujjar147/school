import { existsSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { balanceMinor, formatMoney, summariseMarks, gradeFor, percentOf } from '@sms/shared';
import { uploadDir } from './uploads.js';
import type { Settings } from './settings.js';

/**
 * Printable documents: fee vouchers, receipts, report cards, student ID cards.
 * PDFKit renders PNG and JPEG only; WebP photos/logos are skipped (initials are shown instead).
 */

type Doc = InstanceType<typeof PDFDocument>;

function collect(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/** Absolute path of a stored upload when PDFKit can draw it; null otherwise. */
export function drawableUpload(publicPath?: string | null): string | null {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const abs = path.resolve(uploadDir, publicPath.slice('/uploads/'.length));
  if (!abs.startsWith(uploadDir + path.sep)) return null; // never leave the upload directory
  if (!/\.(png|jpe?g)$/i.test(abs) || !existsSync(abs)) return null;
  return abs;
}

function useFont(doc: Doc) {
  const fontPath = process.env.REPORT_FONT_PATH;
  if (fontPath && existsSync(fontPath)) { doc.registerFont('body', fontPath); doc.font('body'); }
}

function letterhead(doc: Doc, s: Settings, title: string, x = 36, width = doc.page.width - 72) {
  const logo = drawableUpload(s.logoPath);
  let tx = x;
  if (logo) { try { doc.image(logo, x, doc.y, { fit: [40, 40] }); tx = x + 50; } catch { /* unsupported */ } }
  const top = doc.y;
  doc.fillColor(s.primaryColor).fontSize(14).text(s.name, tx, top, { width: width - (tx - x) });
  const contact = [s.address, s.phone, s.email].filter(Boolean).join('  ·  ');
  if (contact) doc.fillColor('#555').fontSize(8).text(contact, tx, doc.y, { width: width - (tx - x) });
  doc.fillColor('#111').fontSize(11).text(title, tx, doc.y + 2, { width: width - (tx - x) });
  doc.y = Math.max(doc.y, top + 44) + 6;
  doc.moveTo(x, doc.y).lineTo(x + width, doc.y).strokeColor(s.primaryColor).lineWidth(1).stroke();
  doc.y += 8;
}

function kv(doc: Doc, rows: [string, string][], x: number, width: number) {
  doc.fontSize(9);
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.fillColor('#666').text(k, x, y, { width: width * 0.38 });
    doc.fillColor('#111').text(v, x + width * 0.4, y, { width: width * 0.6 });
    doc.y = Math.max(doc.y, y + 12);
  }
}

// ------------------------------------------------------------------ Fee voucher
export interface VoucherDocInput {
  voucher: { voucherNumber: string; title: string; period: string; issueDate: string; dueDate: string; items: { label: string; amountMinor: number }[]; lateFeeMinor: number; discountMinor: number; totalMinor: number; paidMinor: number; status: string; currency: string; notes?: string | null };
  student: { fullName: string; admissionNumber: string };
  className: string;
}

/** Two copies on one A4 page (parent copy / school copy), separated by a cut line. */
export async function renderVoucherPdf(input: VoucherDocInput, s: Settings): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Fee voucher ${input.voucher.voucherNumber}`, Author: s.name } });
  const out = collect(doc);
  useFont(doc);
  const v = input.voucher;
  const money = (m: number) => formatMoney(m, v.currency);
  const w = doc.page.width - 72;
  const copy = (label: string, top: number) => {
    doc.y = top;
    letterhead(doc, s, `Fee voucher — ${label}`);
    const colW = w / 2 - 10;
    const y0 = doc.y;
    kv(doc, [['Voucher no.', v.voucherNumber], ['Student', input.student.fullName], ['Admission no.', input.student.admissionNumber], ['Class', input.className]], 36, colW);
    const yL = doc.y; doc.y = y0;
    kv(doc, [['Fee', v.title], ['Period', v.period], ['Issued', v.issueDate], ['Due date', v.dueDate]], 36 + colW + 20, colW);
    doc.y = Math.max(yL, doc.y) + 6;
    // Line items
    const rowY = () => doc.y;
    doc.rect(36, rowY(), w, 15).fill('#eef1f5');
    doc.fillColor('#222').fontSize(9).text('Description', 40, doc.y + 3, { width: w * 0.65 }).text('Amount', 36 + w * 0.65, doc.y - 11, { width: w * 0.35 - 4, align: 'right' });
    doc.y += 4;
    const line = (label: string, amount: string, bold = false) => {
      const y = doc.y;
      doc.fillColor(bold ? '#000' : '#111').fontSize(bold ? 10 : 9).text(label, 40, y, { width: w * 0.65 });
      doc.text(amount, 36 + w * 0.65, y, { width: w * 0.35 - 4, align: 'right' });
      doc.y = y + (bold ? 15 : 13);
    };
    for (const it of v.items) line(it.label, money(it.amountMinor));
    if (v.lateFeeMinor) line('Late fee', money(v.lateFeeMinor));
    if (v.discountMinor) line('Discount', '-' + money(v.discountMinor));
    doc.moveTo(36, doc.y).lineTo(36 + w, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke(); doc.y += 3;
    line('Total payable', money(v.totalMinor), true);
    if (v.paidMinor) { line('Paid so far', money(v.paidMinor)); line('Balance', money(balanceMinor(v.totalMinor, v.paidMinor)), true); }
    doc.fillColor(v.status === 'paid' ? '#047857' : '#b45309').fontSize(9).text(`Status: ${v.status.toUpperCase()}`, 36, doc.y + 2);
    const footer = [v.notes, s.fees?.voucherFooter].filter(Boolean).join('  ');
    if (footer) doc.fillColor('#555').fontSize(8).text(footer, 36, doc.y + 4, { width: w });
  };
  const half = doc.page.height / 2;
  copy('Parent copy', 36);
  doc.save().dash(4, { space: 4 }).moveTo(20, half).lineTo(doc.page.width - 20, half).strokeColor('#999').stroke().restore();
  doc.fillColor('#999').fontSize(7).text('- - cut here - -', 36, half - 10);
  copy('School copy', half + 16);
  doc.end();
  return out;
}

// ------------------------------------------------------------------ Receipt
export interface ReceiptDocInput {
  payment: { receiptNumber: string; amountMinor: number; overpaidMinor: number; currency: string; method: string; provider?: string | null; transactionRef?: string | null; reference?: string | null; paidAt: Date };
  voucher: { voucherNumber: string; title: string; period: string; totalMinor: number; paidMinor: number };
  student: { fullName: string; admissionNumber: string };
  className: string;
  receivedByName?: string | null;
}

export async function renderReceiptPdf(input: ReceiptDocInput, s: Settings): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A5', margin: 30, info: { Title: `Receipt ${input.payment.receiptNumber}`, Author: s.name } });
  const out = collect(doc);
  useFont(doc);
  const p = input.payment; const money = (m: number) => formatMoney(m, p.currency);
  const w = doc.page.width - 60;
  letterhead(doc, s, 'Payment receipt', 30, w);
  kv(doc, [
    ['Receipt no.', p.receiptNumber],
    ['Date', p.paidAt.toISOString().slice(0, 10)],
    ['Student', input.student.fullName],
    ['Admission no.', input.student.admissionNumber],
    ['Class', input.className],
    ['Voucher', `${input.voucher.voucherNumber} — ${input.voucher.title} (${input.voucher.period})`],
    ['Method', p.method === 'online' ? `Online${p.provider ? ` (${p.provider})` : ''}` : p.method.replace('_', ' ')],
    ...(p.transactionRef ? [['Transaction ref.', p.transactionRef] as [string, string]] : []),
    ...(p.reference ? [['Reference', p.reference] as [string, string]] : []),
    ...(input.receivedByName ? [['Received by', input.receivedByName] as [string, string]] : [])
  ], 30, w);
  doc.y += 8;
  doc.rect(30, doc.y, w, 30).fill('#eef6f1');
  doc.fillColor('#065f46').fontSize(13).text(`Amount received: ${money(p.amountMinor)}`, 40, doc.y + 9, { width: w - 20 });
  doc.y += 30;
  doc.fillColor('#111').fontSize(9).text(`Voucher balance after this payment: ${money(balanceMinor(input.voucher.totalMinor, input.voucher.paidMinor))}`, 30, doc.y + 4);
  if (p.overpaidMinor > 0) doc.fillColor('#b45309').text(`Overpayment of ${money(p.overpaidMinor)} recorded — the school will refund or adjust it.`, 30, doc.y + 2, { width: w });
  doc.fillColor('#888').fontSize(7).text(`Computer-generated receipt from ${s.name}. Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC.`, 30, doc.page.height - 50, { width: w, align: 'center' });
  doc.end();
  return out;
}

// ------------------------------------------------------------------ Report card
export interface ReportCardInput {
  exam: { name: string; term?: string | null; startDate: string };
  student: { fullName: string; admissionNumber: string };
  className: string;
  sessionName?: string;
  rows: { subject: string; maxMarks: number; marksObtained: number | null; absent?: boolean; remarks?: string | null }[];
  attendancePercent?: number | null;
}

export async function renderReportCardPdf(input: ReportCardInput, s: Settings): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Report card — ${input.student.fullName}`, Author: s.name } });
  const out = collect(doc);
  useFont(doc);
  const w = doc.page.width - 72;
  letterhead(doc, s, `Report card — ${input.exam.name}${input.exam.term ? ` (${input.exam.term})` : ''}`);
  kv(doc, [['Student', input.student.fullName], ['Admission no.', input.student.admissionNumber], ['Class', input.className], ...(input.sessionName ? [['Session', input.sessionName] as [string, string]] : [])], 36, w / 2);
  doc.y += 8;
  const cols = [{ h: 'Subject', w: 0.34 }, { h: 'Max', w: 0.12 }, { h: 'Obtained', w: 0.14 }, { h: '%', w: 0.12 }, { h: 'Grade', w: 0.1 }, { h: 'Remarks', w: 0.18 }];
  const xs: number[] = []; cols.reduce((x, c, i) => { xs[i] = x; return x + c.w * w; }, 36);
  doc.rect(36, doc.y, w, 16).fill('#eef1f5');
  const hy = doc.y + 4;
  doc.fillColor('#222').fontSize(9); cols.forEach((c, i) => doc.text(c.h, xs[i]! + 4, hy, { width: c.w * w - 8, lineBreak: false }));
  doc.y = hy + 16;
  for (const r of input.rows) {
    const y = doc.y; const pct = r.absent ? 0 : percentOf(r.marksObtained ?? 0, r.maxMarks);
    const cells = [r.subject, String(r.maxMarks), r.absent ? 'Absent' : String(r.marksObtained ?? '—'), pct === null ? '—' : `${pct}%`, gradeFor(pct), r.remarks ?? ''];
    doc.fillColor('#111'); cells.forEach((c, i) => doc.text(c, xs[i]! + 4, y, { width: cols[i]!.w * w - 8, lineBreak: false, ellipsis: true }));
    doc.y = y + 15;
    doc.moveTo(36, doc.y - 2).lineTo(36 + w, doc.y - 2).strokeColor('#eee').lineWidth(0.5).stroke();
  }
  const sum = summariseMarks(input.rows);
  doc.y += 10;
  doc.fontSize(11).fillColor('#000').text(`Total: ${sum.obtained} / ${sum.max}   ·   Percentage: ${sum.percent ?? '—'}%   ·   Grade: ${sum.grade}   ·   Result: ${sum.passed ? 'PASS' : 'NOT PASSED'}`, 36, doc.y, { width: w });
  if (input.attendancePercent !== undefined) doc.fontSize(9).fillColor('#444').text(`Attendance this session: ${input.attendancePercent ?? '—'}%`, 36, doc.y + 4);
  doc.y = doc.page.height - 110;
  doc.fontSize(9).fillColor('#111');
  doc.text('______________________', 36, doc.y).text('Class teacher', 36, doc.y + 2);
  doc.text('______________________', 36 + w - 150, doc.page.height - 110).text('Principal', 36 + w - 150, doc.page.height - 96);
  doc.end();
  return out;
}

// ------------------------------------------------------------------ Student ID cards
export interface IdCardInput { fullName: string; admissionNumber: string; className: string; sectionName?: string; sessionName?: string; photoPath?: string | null; verifyUrl: string; validUntil?: string | null }

/** ISO/IEC 7810 ID-1 (credit-card size): 85.6 × 54 mm. */
const CARD_W = 242.65; const CARD_H = 153.07;

async function drawCard(doc: Doc, c: IdCardInput, s: Settings, x: number, y: number) {
  const brand = s.primaryColor;
  doc.save();
  doc.roundedRect(x, y, CARD_W, CARD_H, 8).lineWidth(0.6).strokeColor('#bbb').stroke();
  // Header band
  doc.save().roundedRect(x, y, CARD_W, 34, 8).clip().rect(x, y, CARD_W, 34).fill(brand).restore();
  const logo = drawableUpload(s.logoPath);
  let tx = x + 8;
  if (logo) { try { doc.image(logo, x + 6, y + 5, { fit: [24, 24] }); tx = x + 34; } catch { /* unsupported */ } }
  doc.fillColor('#fff').fontSize(9.5).text(s.name, tx, y + 7, { width: CARD_W - (tx - x) - 8, lineBreak: false, ellipsis: true });
  doc.fontSize(6.5).text('STUDENT IDENTITY CARD', tx, y + 20, { width: CARD_W - (tx - x) - 8, lineBreak: false });
  // Photo
  const px = x + 8; const py = y + 42; const pw = 58; const ph = 72;
  doc.rect(px, py, pw, ph).lineWidth(0.5).strokeColor('#ccc').stroke();
  const photo = drawableUpload(c.photoPath);
  let drew = false;
  if (photo) { try { doc.image(photo, px + 1, py + 1, { cover: [pw - 2, ph - 2], align: 'center', valign: 'center' }); drew = true; } catch { /* unsupported */ } }
  if (!drew) {
    const initials = c.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
    doc.rect(px + 1, py + 1, pw - 2, ph - 2).fill('#eef1f5');
    doc.fillColor('#8a94a6').fontSize(20).text(initials, px, py + ph / 2 - 12, { width: pw, align: 'center' });
  }
  // Details
  const dx = px + pw + 8; const dw = CARD_W - (dx - x) - 66;
  let dy = py;
  const field = (label: string, value: string, big = false) => {
    doc.fillColor('#6b7280').fontSize(5.5).text(label.toUpperCase(), dx, dy, { width: dw, lineBreak: false });
    dy += 7;
    doc.fillColor('#111').fontSize(big ? 8.5 : 7.5).text(value, dx, dy, { width: dw, lineBreak: false, ellipsis: true });
    dy += big ? 12 : 11;
  };
  field('Name', c.fullName, true);
  field('Admission no.', c.admissionNumber);
  field('Class / Section', [c.className, c.sectionName].filter(Boolean).join(' · '));
  if (c.sessionName) field('Session', c.sessionName);
  // QR
  const qr = await QRCode.toBuffer(c.verifyUrl, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 240 });
  doc.image(qr, x + CARD_W - 64, py, { width: 56, height: 56 });
  doc.fillColor('#6b7280').fontSize(5).text('Scan to verify', x + CARD_W - 64, py + 58, { width: 56, align: 'center' });
  // Footer
  doc.rect(x, y + CARD_H - 18, CARD_W, 0.6).fill('#e5e7eb');
  const foot = [s.phone ? `If found, please call ${s.phone}` : 'If found, please return to the school office', c.validUntil ? `Valid until ${c.validUntil}` : null].filter(Boolean).join('  ·  ');
  doc.fillColor('#4b5563').fontSize(5.5).text(foot, x + 8, y + CARD_H - 12, { width: CARD_W - 16, align: 'center', lineBreak: false, ellipsis: true });
  doc.restore();
}

/**
 * layout 'sheet': A4 print sheet, 2 × 5 cards with crop-friendly spacing (bulk printing).
 * layout 'card' : one card per page at exact card size (card printers).
 */
export async function renderIdCardsPdf(cards: IdCardInput[], s: Settings, layout: 'sheet' | 'card'): Promise<Buffer> {
  if (layout === 'card') {
    const doc = new PDFDocument({ size: [CARD_W, CARD_H], margin: 0, autoFirstPage: false, info: { Title: 'Student ID cards', Author: s.name } });
    const out = collect(doc);
    useFont(doc);
    for (const c of cards) { doc.addPage({ size: [CARD_W, CARD_H], margin: 0 }); await drawCard(doc, c, s, 0, 0); }
    doc.end();
    return out;
  }
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Student ID cards', Author: s.name } });
  const out = collect(doc);
  useFont(doc);
  const cols = 2; const rows = 5; const gapX = 18; const gapY = 8;
  const marginX = (595.28 - cols * CARD_W - (cols - 1) * gapX) / 2;
  const marginY = (841.89 - rows * CARD_H - (rows - 1) * gapY) / 2;
  for (let i = 0; i < cards.length; i++) {
    if (i % (cols * rows) === 0) doc.addPage({ size: 'A4', margin: 0 });
    const slot = i % (cols * rows);
    const cx = marginX + (slot % cols) * (CARD_W + gapX);
    const cy = marginY + Math.floor(slot / cols) * (CARD_H + gapY);
    await drawCard(doc, cards[i]!, s, cx, cy);
  }
  if (!cards.length) { doc.addPage({ size: 'A4', margin: 36 }); doc.fontSize(12).text('No students to print.', 36, 36); }
  doc.end();
  return out;
}
