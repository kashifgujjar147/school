import { fileURLToPath } from 'node:url';
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
  // Brand images bundled with the app (/brand/<name>.png), e.g. the logo set by `npm run website:alpha`.
  const bundled = publicPath?.match(/^\/brand\/([a-z0-9-]+\.(?:png|jpe?g))$/i);
  if (bundled) { const abs = path.join(bundledBrandDir, bundled[1]!); return existsSync(abs) ? abs : null; }
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const abs = path.resolve(uploadDir, publicPath.slice('/uploads/'.length));
  if (!abs.startsWith(uploadDir + path.sep)) return null; // never leave the upload directory
  if (!/\.(png|jpe?g)$/i.test(abs) || !existsSync(abs)) return null;
  return abs;
}
/** server/assets/brand — resolved from both src/ (tsx) and dist/ (compiled), which sit at the same depth. */
const bundledBrandDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/brand');

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
  const W = CARD_W; const H = CARD_H; const R = 9;
  const navy = hex(s.primaryColor, '#1c1f5e'); const deep = shade(navy, -0.45); const sky = hex(s.accentColor, '#29abe2');
  const ink = '#12153d'; const muted = '#7a809b';
  const custom = Boolean(process.env.REPORT_FONT_PATH && existsSync(process.env.REPORT_FONT_PATH));
  const bold = custom ? 'body' : 'Helvetica-Bold'; const reg = custom ? 'body' : 'Helvetica';
  const [schoolMain, schoolSub] = splitName(s.name);
  const logo = drawableUpload(s.logoPath);

  doc.save();
  // Card shape: everything below is clipped to the rounded card, so nothing can spill outside it.
  doc.roundedRect(x, y, W, H, R).clip();
  doc.rect(x, y, W, H).fill(doc.linearGradient(x, y, x, y + H).stop(0, '#ffffff').stop(1, '#eef2f8'));

  // Faint emblem watermark behind the details.
  if (logo) { try { doc.save().opacity(0.045).image(logo, x + W / 2 - 30, y + 52, { fit: [92, 92] }).restore(); } catch { doc.restore(); } }

  // Header: navy gradient, soft rings, sky hairline.
  const HH = 40;
  doc.rect(x, y, W, HH).fill(doc.linearGradient(x, y, x + W, y + HH).stop(0, deep).stop(1, navy));
  doc.save().opacity(0.08).lineWidth(7).strokeColor('#ffffff').circle(x + W - 16, y + 2, 34).stroke()
    .lineWidth(1).circle(x + W - 16, y + 2, 52).stroke().restore();
  doc.rect(x, y + HH, W, 1.6).fill(sky);

  // Logo medallion.
  const lx = x + 22; const ly = y + HH / 2; const lr = 14;
  doc.circle(lx, ly, lr + 1.2).fill(sky);
  doc.circle(lx, ly, lr).fill('#ffffff');
  if (logo) {
    const li = lr - 1.4;
    try { doc.save().circle(lx, ly, lr - 0.6).clip().image(logo, lx - li, ly - li, { fit: [li * 2, li * 2], align: 'center', valign: 'center' }).restore(); } catch { doc.restore(); }
  }
  const tx = x + 42; const tw = W - (tx - x) - 10;
  const main = schoolMain.toUpperCase();
  doc.font(bold).fillColor('#ffffff').fontSize(fitSize(doc, main, tw, 8.2, 5.5, 0.4)).text(main, tx, y + 9, { width: tw, lineBreak: false, ellipsis: true, characterSpacing: 0.4 });
  doc.font(bold).fillColor(sky).fontSize(5.6).text((schoolSub ?? 'Student identity card').toUpperCase(), tx, y + 20, { width: tw, lineBreak: false, ellipsis: true, characterSpacing: 1.4 });
  if (schoolSub) doc.font(reg).fillColor('#ffffff').fillOpacity(0.75).fontSize(4.8).text('STUDENT IDENTITY CARD', tx, y + 28.5, { width: tw, lineBreak: false, characterSpacing: 1.6 }).fillOpacity(1);

  // Photo: rounded frame with a sky ring. The image is cover-fitted and clipped to the frame.
  const px = x + 11; const py = y + HH + 10; const pw = 58; const ph = 72; const pr = 6;
  doc.roundedRect(px - 2.2, py - 2.2, pw + 4.4, ph + 4.4, pr + 2).lineWidth(0.9).strokeColor(sky).stroke();
  doc.roundedRect(px, py, pw, ph, pr).fill('#e8ecf4');
  const photo = drawableUpload(c.photoPath);
  let drew = false;
  if (photo) {
    doc.save();
    try { doc.roundedRect(px, py, pw, ph, pr).clip().image(photo, px, py, { cover: [pw, ph], align: 'center', valign: 'center' }); drew = true; } catch { /* unsupported */ }
    doc.restore();
  }
  if (!drew) {
    const initials = c.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
    doc.roundedRect(px, py, pw, ph, pr).fill(doc.linearGradient(px, py, px, py + ph).stop(0, '#eef1f8').stop(1, '#dbe2ee'));
    doc.font(bold).fillColor(navy).fillOpacity(0.5).fontSize(20).text(initials, px, py + ph / 2 - 10, { width: pw, align: 'center', lineBreak: false }).fillOpacity(1);
  }

  // Details.
  const qs = 50; const qx = x + W - qs - 11;
  const dx = px + pw + 11; const dw = qx - dx - 8;
  let dy = py + 1;
  const name = c.fullName.toUpperCase();
  doc.font(bold).fillColor(navy);
  const nameSize = fitSize(doc, name, dw - 1, 9.5, 7.4, 0.2);
  if (doc.fontSize(nameSize).widthOfString(name) + 0.2 * name.length <= dw - 1) {
    doc.text(name, dx, dy, { width: dw, lineBreak: false, characterSpacing: 0.2 });
    dy += 12.5;
  } else {
    // Long names: two lines at most, never over the details below.
    doc.fontSize(7).text(name, dx, dy, { width: dw, height: 20, ellipsis: true, lineGap: 0.4, characterSpacing: 0.1 });
    dy += 19;
  }
  doc.rect(dx, dy, 16, 1.4).fill(sky);
  dy += 6;
  const field = (label: string, value: string) => {
    doc.font(bold).fillColor(muted).fontSize(4.6).text(label.toUpperCase(), dx, dy, { width: dw, lineBreak: false, characterSpacing: 1.1 });
    dy += 6.4;
    doc.font(bold).fillColor(ink).fontSize(7.2).text(value || '-', dx, dy, { width: dw, lineBreak: false, ellipsis: true });
    dy += 11.4;
  };
  field('Admission no.', c.admissionNumber);
  field('Class / Section', [c.className, c.sectionName].filter(Boolean).join(' · '));
  if (c.sessionName) field('Session', c.sessionName);

  // QR on a white tile.
  const qy = py;
  doc.roundedRect(qx - 2, qy - 2, qs + 4, qs + 4, 5).fill('#ffffff');
  doc.roundedRect(qx - 2, qy - 2, qs + 4, qs + 4, 5).lineWidth(0.5).strokeColor('#d9deea').stroke();
  const qr = await QRCode.toBuffer(c.verifyUrl, { type: 'png', errorCorrectionLevel: 'M', margin: 0, width: 300, color: { dark: deep, light: '#ffffff' } });
  doc.image(qr, qx + 2, qy + 2, { width: qs - 4, height: qs - 4 });
  doc.font(bold).fillColor(muted).fontSize(4.4).text('SCAN TO VERIFY', qx - 6, qy + qs + 6, { width: qs + 12, align: 'center', lineBreak: false, characterSpacing: 0.9 });

  // Footer band.
  const fh = 15; const fy = y + H - fh;
  doc.rect(x, fy, W, fh).fill(doc.linearGradient(x, fy, x + W, fy).stop(0, navy).stop(1, deep));
  doc.rect(x, fy, W, 0.9).fill(sky);
  const left = c.validUntil ? `VALID UNTIL  ${c.validUntil}` : 'STUDENT IDENTITY CARD';
  const right = s.phone ? `IF FOUND, PLEASE CALL  ${s.phone}` : 'IF FOUND, RETURN TO THE SCHOOL OFFICE';
  // Both footer lines are sized to fit one line: a wrapped line would fall off the card (and add a page).
  const lw = 92; const rw = W - 22 - lw - 6;
  doc.font(bold).fillColor('#ffffff').fontSize(fitSize(doc, left, lw - 2, 4.8, 3.6, 0.8)).text(left, x + 11, fy + 5.6, { width: lw, lineBreak: false, characterSpacing: 0.8 });
  doc.font(reg).fillColor('#ffffff').fillOpacity(0.85).fontSize(fitSize(doc, right, rw - 2, 4.8, 3.6, 0.4)).text(right, x + W - 11 - rw, fy + 5.6, { width: rw, align: 'right', lineBreak: false, characterSpacing: 0.4 }).fillOpacity(1);
  doc.restore();

  // Hairline edge, outside the clip so it stays crisp.
  doc.roundedRect(x + 0.25, y + 0.25, W - 0.5, H - 0.5, R).lineWidth(0.5).strokeColor('#cfd5e3').stroke();
}

const hex = (v: string | null | undefined, fallback: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
/** Darken (amt < 0) or lighten (amt > 0) a #rrggbb colour. */
function shade(c: string, amt: number) {
  const n = parseInt(c.slice(1), 16);
  const ch = (v: number) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt).toString(16).padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
/** "The Alpha School System — 47 Campus" → ["The Alpha School System", "47 Campus"]. */
function splitName(name: string): [string, string | null] {
  const parts = name.trim().split(/\s+[—–|·-]\s+/);
  return parts.length > 1 ? [parts[0]!, parts.slice(1).join(' · ')] : [name.trim(), null];
}
/** Largest font size (max → min) at which a single line of text fits the width. */
function fitSize(doc: Doc, text: string, width: number, max: number, min: number, spacing = 0) {
  for (let size = max; size > min; size -= 0.25) {
    doc.fontSize(size);
    if (doc.widthOfString(text) + spacing * text.length <= width) return size;
  }
  return min;
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
