"use strict";

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} = require("docx");

const COLORS = {
  blue: "0B63B6",
  darkBlue: "062F5F",
  sky: "10A8E8",
  green: "66C943",
  orange: "F58220",
  honey: "FDB515",
  red: "E52420",
  text: "1F2933",
  muted: "52616B",
  border: "D8E3EF",
  light: "F5F7FA"
};

const IMAGE_ERROR_PREFIX = "[report-image]";
const MAX_IMAGE_BYTES = 14 * 1024 * 1024;

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function longText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function empty(value) {
  const s = text(value);
  return !s || s === "-" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined";
}

function stripEmoji(value) {
  return text(value).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
}

function slug(value) {
  return text(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "relatorio";
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function downloadName(format, mode) {
  const day = new Date().toISOString().slice(0, 10);
  return `relatorio-turismo-itatinga-${mode === "publico" ? "publico" : "interno"}-${day}.${format}`;
}

function normalizeReportPayload(body) {
  const payload = body && typeof body === "object" ? body : {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    mode: payload.mode === "publico" ? "publico" : "interno",
    filtros: payload.filtros && typeof payload.filtros === "object" ? payload.filtros : {},
    items: items.map((item) => ({
      label: text(item.label || "Módulo"),
      icon: text(item.icon || ""),
      fields: Array.isArray(item.fields) ? item.fields : [],
      sections: Array.isArray(item.sections) ? item.sections : [],
      recs: Array.isArray(item.recs) ? item.recs : []
    }))
  };
}

function passFilters(record, filtros) {
  const q = text(filtros.q).toLowerCase();
  const st = text(filtros.st);
  const cat = text(filtros.cat);
  if (q && !JSON.stringify(record || {}).toLowerCase().includes(q)) return false;
  if (st && record.status !== st && record.status !== undefined) return false;
  if (cat && record.categoria !== cat) return false;
  return true;
}

function hiddenPublicField(key, label) {
  const s = `${key || ""} ${label || ""}`.toLowerCase();
  return /(cpf|rg|cnpj\/cpf|cnpj_cpf|residencial|senha|auditoria|observa[cç][aã]o interna|contato do respons[aá]vel|respons[aá]vel|propriet[aá]rio|usu[aá]rio|login)/i.test(s);
}

function fieldType(field) {
  return Array.isArray(field) ? field[2] : "";
}

function fieldKey(field) {
  return Array.isArray(field) ? field[0] : "";
}

function fieldLabel(field) {
  return Array.isArray(field) ? field[1] : fieldKey(field);
}

function fieldValue(record, key) {
  const value = record ? record[key] : "";
  return typeof value === "string" ? longText(value) : value;
}

function normalizeSections(item, record, mode) {
  const sections = item.sections && item.sections.length
    ? item.sections
    : [{ t: "", f: item.fields || [] }];

  return sections.map((section) => {
    const title = text(section.t || "");
    if (mode === "publico" && /contato do respons[aá]vel/i.test(title)) return null;
    const fields = Array.isArray(section.f) ? section.f : [];
    const rows = fields
      .filter((field) => fieldType(field) !== "photo")
      .filter((field) => fieldKey(field) !== "publicar_guia")
      .filter((field) => !(mode === "publico" && hiddenPublicField(fieldKey(field), fieldLabel(field))))
      .map((field) => ({
        key: fieldKey(field),
        label: text(fieldLabel(field)),
        value: fieldValue(record, fieldKey(field))
      }))
      .filter((row) => !empty(row.value));
    if (!rows.length) return null;
    return { title, rows };
  }).filter(Boolean);
}

function collectRows(payload) {
  const categories = [];
  let total = 0;
  for (const item of payload.items) {
    const records = (item.recs || []).filter((record) => passFilters(record, payload.filtros));
    if (!records.length) continue;
    const prepared = records.map((record) => ({
      title: text(record.nome || item.label),
      raw: record,
      sections: normalizeSections(item, record, payload.mode),
      photos: collectPhotos(record)
    })).filter((record) => record.sections.length || record.photos.length);
    if (!prepared.length) continue;
    total += prepared.length;
    categories.push({
      label: stripEmoji(item.label || "Módulo"),
      icon: item.icon,
      records: prepared
    });
  }
  return { categories, total };
}

function collectPhotos(record) {
  const photos = [];
  const add = (value, label) => {
    if (Array.isArray(value)) value.forEach((v, i) => add(v, `${label || "Foto"} ${i + 1}`));
    else if (value && typeof value === "object") add(value.url || value.src || value.imageUrl || value.directUrl || value.viewUrl, value.name || label);
    else if (!empty(value)) photos.push({ src: text(value), label: text(label || "Foto anexada") });
  };
  add(record.foto, record.foto_nome || "Foto anexada");
  add(record.fotos, "Fotos anexadas");
  add(record.imagem, "Imagem anexada");
  return photos.filter((photo, index, all) => all.findIndex((p) => p.src === photo.src) === index);
}

function firstValue(record, keys) {
  for (const key of keys) {
    if (!empty(record?.[key])) return text(record[key]);
  }
  return "";
}

function recordListRow(category, record) {
  const raw = record.raw || {};
  return {
    category: stripEmoji(category.label),
    name: text(record.title || raw.nome || "Registro"),
    responsible: firstValue(raw, ["responsavel", "artesao_nome", "proprietario", "instituicao", "empresa"]),
    phone: firstValue(raw, ["telefone", "resp_telefone", "artesao_telefone", "whatsapp", "celular"]),
    status: firstValue(raw, ["status"])
  };
}

function linkKind(value) {
  const s = text(value);
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s)) return `mailto:${s}`;
  return "";
}

function safeUrl(src, options) {
  const raw = text(src);
  if (!raw) return null;
  try {
    return new URL(raw, options.origin || "http://localhost");
  } catch {
    return null;
  }
}

function resolveLocalUpload(src, options) {
  const url = safeUrl(src, options);
  if (!url) return null;
  const publicPath = (options.uploadPublicPath || "/uploads").replace(/\/$/, "");
  if (!url.pathname.startsWith(`${publicPath}/`)) return null;
  const rel = decodeURIComponent(url.pathname.slice(publicPath.length + 1));
  const uploadRoot = path.resolve(options.uploadDir || "");
  const resolved = path.resolve(uploadRoot, rel);
  if (!resolved.startsWith(uploadRoot + path.sep)) return null;
  return resolved;
}

function allowedRemote(src, options) {
  const url = safeUrl(src, options);
  if (!url) return false;
  const originHost = options.origin ? new URL(options.origin).hostname : "";
  const host = url.hostname.toLowerCase();
  return host === originHost ||
    host.endsWith("googleusercontent.com") ||
    host === "drive.google.com" ||
    host === "docs.google.com";
}

async function fetchRemoteBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (!/^image\//i.test(type)) throw new Error(`MIME inválido: ${type || "desconhecido"}`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_IMAGE_BYTES) throw new Error("imagem acima do limite");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("imagem acima do limite");
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function rawImageBuffer(src, options) {
  const dataMatch = /^data:image\/[^;,]+;base64,(.+)$/i.exec(text(src));
  if (dataMatch) return Buffer.from(dataMatch[1], "base64");

  const localPath = resolveLocalUpload(src, options);
  if (localPath) return fs.promises.readFile(localPath);

  if (!allowedRemote(src, options)) throw new Error("origem de imagem não autorizada para exportação");
  const url = safeUrl(src, options);
  return fetchRemoteBuffer(url.toString());
}

async function prepareImage(photo, record, options) {
  const recName = text(record.title || record.raw?.nome || "sem-nome");
  try {
    const input = await rawImageBuffer(photo.src, options);
    if (!options.sharp) throw new Error("Sharp indisponível para converter imagem");
    const buffer = await options.sharp(input, { failOn: "none", animated: false })
      .rotate()
      .resize({ width: 1800, height: 1200, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    const meta = await options.sharp(buffer).metadata();
    return { ok: true, label: photo.label, buffer, width: meta.width || 1200, height: meta.height || 800 };
  } catch (error) {
    const msg = `${IMAGE_ERROR_PREFIX} registro="${recName}" src="${photo.src}" erro="${error.message}" time="${new Date().toISOString()}"`;
    if (options.logger) options.logger.warn(msg);
    else console.warn(msg);
    return { ok: false, label: photo.label, error: error.message };
  }
}

function fit(width, height, maxWidth, maxHeight) {
  if (!width || !height) return { width: maxWidth, height: Math.round(maxWidth * 0.56) };
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function prepareRecordImages(categories, options) {
  for (const category of categories) {
    for (const record of category.records) {
      record.images = [];
      for (const photo of record.photos) {
        record.images.push(await prepareImage(photo, record, options));
      }
    }
  }
}

function docxTextRun(value, options = {}) {
  return new TextRun({ text: String(value || ""), font: "Aptos", color: options.color || COLORS.text, size: options.size || 21, bold: Boolean(options.bold), italics: Boolean(options.italics) });
}

function docxParagraph(children, options = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [docxTextRun(children, options)],
    spacing: { after: options.after ?? 90, before: options.before ?? 0 },
    alignment: options.alignment || AlignmentType.LEFT,
    heading: options.heading
  });
}

function docxLink(value) {
  const s = text(value);
  const link = linkKind(s);
  if (!link) return docxTextRun(s);
  return new ExternalHyperlink({
    link,
    children: [new TextRun({ text: s, style: "Hyperlink", font: "Aptos", size: 21 })]
  });
}

function tableCell(children, options = {}) {
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.shading ? { fill: options.shading } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
      left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
      right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }
    },
    children: Array.isArray(children) ? children : [docxParagraph(children, { color: options.color, bold: options.bold })]
  });
}

async function buildReportDocx(payload, options = {}) {
  const { categories, total } = collectRows(payload);
  if (!total) return { buffer: await Packer.toBuffer(new Document({ sections: [{ children: [docxParagraph("Nenhum registro encontrado.")] }] })), filename: downloadName("docx", payload.mode) };
  await prepareRecordImages(categories, options);

  const children = [
    docxParagraph("Prefeitura Municipal de Itatinga", { alignment: AlignmentType.CENTER, size: 28, bold: true }),
    docxParagraph("Gestão do Turismo de Itatinga", { alignment: AlignmentType.CENTER, size: 32, bold: true }),
    docxParagraph("Inventário Turístico Municipal", { alignment: AlignmentType.CENTER, size: 28, bold: true }),
    docxParagraph(`Relatório ${payload.mode === "publico" ? "Público" : "Interno"}`, { alignment: AlignmentType.CENTER }),
    docxParagraph(`Emitido em ${formatDate()} · ${total} registro(s)`, { alignment: AlignmentType.CENTER }),
    docxParagraph("Resumo por categoria", { heading: HeadingLevel.HEADING_1, before: 360 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [tableCell("Categoria", { shading: COLORS.darkBlue, color: "FFFFFF", bold: true, width: 78 }), tableCell("Registros", { shading: COLORS.darkBlue, color: "FFFFFF", bold: true, width: 22 })] }),
        ...categories.map((category) => new TableRow({ children: [tableCell(category.label), tableCell(String(category.records.length))] }))
      ]
    }),
    new Paragraph({ children: [new PageBreak()] })
  ];

  for (const category of categories) {
    children.push(docxParagraph(`${category.icon ? category.icon + " " : ""}${category.label} (${category.records.length})`, { heading: HeadingLevel.HEADING_1, before: 180, after: 160 }));
    for (const record of category.records) {
      children.push(docxParagraph(record.title, { heading: HeadingLevel.HEADING_2, before: 180, after: 90 }));
      for (const section of record.sections) {
        if (section.title) children.push(docxParagraph(stripEmoji(section.title).toUpperCase(), { color: COLORS.blue, bold: true, size: 19, after: 45 }));
        for (const row of section.rows) {
          children.push(new Paragraph({
            children: [
              docxTextRun(`${row.label}: `, { bold: true, color: COLORS.darkBlue }),
              docxLink(row.value)
            ],
            spacing: { after: 55 }
          }));
        }
      }
      if (record.images?.length) {
        children.push(docxParagraph("Fotografia / imagem anexada", { color: COLORS.blue, bold: true, size: 19, before: 90, after: 45 }));
        for (const img of record.images) {
          if (!img.ok) {
            children.push(docxParagraph("Fotografia não disponível", { italics: true, color: COLORS.muted }));
            continue;
          }
          const size = fit(img.width, img.height, 520, 250);
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data: img.buffer, transformation: size, type: "jpg" })],
            spacing: { after: 120 }
          }));
        }
      }
    }
  }

  const doc = new Document({
    creator: "Gestão do Turismo de Itatinga",
    title: "Relatório do Inventário Turístico Municipal",
    description: "Relatório gerado pelo Sistema de Gestão do Turismo de Itatinga",
    styles: {
      default: { document: { run: { font: "Aptos", size: 21, color: COLORS.text } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Aptos Display", size: 32, bold: true, color: COLORS.darkBlue }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Aptos Display", size: 25, bold: true, color: COLORS.darkBlue }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true } }
      ]
    },
    sections: [{
      properties: { titlePage: true, page: { margin: { top: 851, right: 851, bottom: 851, left: 851 } } },
      headers: {
        first: new Header({ children: [] }),
        default: new Header({ children: [docxParagraph("Gestão do Turismo de Itatinga · Inventário Turístico Municipal", { color: COLORS.muted, size: 17, alignment: AlignmentType.RIGHT })] })
      },
      footers: {
        first: new Footer({ children: [] }),
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [docxTextRun(`Emitido em ${formatDate()} · Página `, { size: 17, color: COLORS.muted }), new TextRun({ children: [PageNumber.CURRENT], size: 17, color: COLORS.muted }), docxTextRun(" de ", { size: 17, color: COLORS.muted }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 17, color: COLORS.muted })] })] })
      },
      children
    }]
  });

  return {
    buffer: await Packer.toBuffer(doc),
    filename: downloadName("docx", payload.mode),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
}

async function buildReportXlsx(payload) {
  const { categories, total } = collectRows(payload);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Gestão do Turismo de Itatinga";
  workbook.created = new Date();

  const resumo = workbook.addWorksheet("Resumo");
  resumo.columns = [{ header: "Item", key: "item", width: 34 }, { header: "Valor", key: "valor", width: 50 }];
  resumo.addRows([
    { item: "Relatório", valor: payload.mode === "publico" ? "Público" : "Interno" },
    { item: "Emitido em", valor: formatDate() },
    { item: "Total de registros", valor: total },
    { item: "Filtro de busca", valor: text(payload.filtros.q) || "Todos" },
    { item: "Filtro de situação", valor: text(payload.filtros.st) || "Todas" }
  ]);
  resumo.addRow({});
  resumo.addRow({ item: "Categoria", valor: "Quantidade" });
  categories.forEach((category) => resumo.addRow({ item: category.label, valor: category.records.length }));

  const sheet = workbook.addWorksheet("Registros");
  sheet.columns = [
    { header: "Categoria", key: "categoria", width: 30 },
    { header: "Registro", key: "registro", width: 34 },
    { header: "Seção", key: "secao", width: 28 },
    { header: "Campo", key: "campo", width: 30 },
    { header: "Valor", key: "valor", width: 70 }
  ];
  categories.forEach((category) => {
    category.records.forEach((record) => {
      record.sections.forEach((section) => {
        section.rows.forEach((row) => {
          sheet.addRow({ categoria: category.label, registro: record.title, secao: section.title || "", campo: row.label, valor: row.value });
        });
      });
    });
  });

  for (const ws of [resumo, sheet]) {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.darkBlue}` } };
    ws.eachRow((row) => row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { top: { style: "thin", color: { argb: "FFD8E3EF" } }, left: { style: "thin", color: { argb: "FFD8E3EF" } }, bottom: { style: "thin", color: { argb: "FFD8E3EF" } }, right: { style: "thin", color: { argb: "FFD8E3EF" } } };
    }));
  }

  return {
    buffer: await workbook.xlsx.writeBuffer(),
    filename: downloadName("xlsx", payload.mode),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
}

function pdfText(doc, value, opts = {}) {
  doc.fillColor(opts.color || `#${COLORS.text}`).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size || 10).text(String(value || ""), opts);
}

function ensurePdfSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 45) doc.addPage();
}

function pdfField(doc, label, value) {
  const s = String(value ?? "");
  ensurePdfSpace(doc, 28);
  doc.font("Helvetica-Bold").fillColor(`#${COLORS.darkBlue}`).fontSize(9.5).text(`${label}: `, { continued: true });
  const link = linkKind(s);
  doc.font("Helvetica").fillColor(link ? `#${COLORS.blue}` : `#${COLORS.text}`).fontSize(9.5).text(s, { link: link || undefined, underline: Boolean(link) });
}

function pdfCellText(doc, value, x, y, width, options = {}) {
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fillColor(options.color || `#${COLORS.text}`)
    .fontSize(options.size || 8.4)
    .text(text(value) || "—", x, y, { width, lineGap: 1 });
}

function pdfSummaryList(doc, categories) {
  const rows = categories.flatMap((category) => category.records.map((record) => recordListRow(category, record)));
  if (!rows.length) return;

  doc.moveDown(1.2);
  pdfText(doc, "Lista de cadastros", { size: 15, bold: true, color: `#${COLORS.darkBlue}` });
  doc.moveDown(0.4);

  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cols = [
    { label: "Cadastro", key: "name", width: Math.round(usable * 0.34) },
    { label: "Responsável", key: "responsible", width: Math.round(usable * 0.27) },
    { label: "Telefone", key: "phone", width: Math.round(usable * 0.20) },
    { label: "Situação", key: "status", width: Math.round(usable * 0.14) }
  ];
  cols[cols.length - 1].width = usable - cols.slice(0, -1).reduce((sum, col) => sum + col.width, 0);

  const drawHeader = () => {
    ensurePdfSpace(doc, 34);
    let x = left;
    const y = doc.y;
    doc.rect(left, y, usable, 20).fill(`#${COLORS.darkBlue}`);
    cols.forEach((col) => {
      pdfCellText(doc, col.label, x + 4, y + 5, col.width - 8, { bold: true, color: "#FFFFFF", size: 8.2 });
      x += col.width;
    });
    doc.y = y + 22;
  };

  drawHeader();
  rows.forEach((row, index) => {
    const values = cols.map((col) => row[col.key] || "—");
    doc.font("Helvetica").fontSize(8.4);
    const heights = values.map((value, i) => doc.heightOfString(text(value) || "—", { width: cols[i].width - 8, lineGap: 1 }));
    const rowHeight = Math.max(22, ...heights.map((h) => h + 10));
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 45) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.rect(left, y, usable, rowHeight).fill(index % 2 ? "#FFFFFF" : `#${COLORS.light}`);
    doc.strokeColor(`#${COLORS.border}`).lineWidth(0.5).rect(left, y, usable, rowHeight).stroke();
    let x = left;
    cols.forEach((col, i) => {
      pdfCellText(doc, values[i], x + 4, y + 5, col.width - 8, { bold: i === 0, size: 8.4 });
      if (i > 0) doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor(`#${COLORS.border}`).stroke();
      x += col.width;
    });
    doc.y = y + rowHeight;
  });
}

function pdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

async function buildReportPdf(payload, options = {}) {
  const { categories, total } = collectRows(payload);
  await prepareRecordImages(categories, options);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 42.5, right: 42.5, bottom: 42.5, left: 42.5 },
    bufferPages: true,
    info: { Title: "Relatório do Inventário Turístico Municipal", Author: "Gestão do Turismo de Itatinga" }
  });

  pdfText(doc, "Prefeitura Municipal de Itatinga", { size: 12, color: `#${COLORS.muted}`, align: "center" });
  doc.moveDown(0.4);
  pdfText(doc, "Gestão do Turismo de Itatinga", { size: 22, bold: true, color: `#${COLORS.darkBlue}`, align: "center" });
  pdfText(doc, "Inventário Turístico Municipal", { size: 16, bold: true, color: `#${COLORS.blue}`, align: "center" });
  doc.moveDown(0.5);
  pdfText(doc, `Relatório ${payload.mode === "publico" ? "Público" : "Interno"} · Emitido em ${formatDate()}`, { size: 10.5, color: `#${COLORS.muted}`, align: "center" });
  pdfText(doc, `${total} registro(s)`, { size: 10.5, color: `#${COLORS.muted}`, align: "center" });
  doc.moveDown(2);
  pdfText(doc, "Resumo por categoria", { size: 15, bold: true, color: `#${COLORS.darkBlue}` });
  doc.moveDown(0.4);
  if (!total) pdfText(doc, "Nenhum registro encontrado.", { size: 11, color: `#${COLORS.muted}` });
  categories.forEach((category) => pdfText(doc, `${category.label}: ${category.records.length}`, { size: 10.5 }));
  pdfSummaryList(doc, categories);

  for (const category of categories) {
    doc.addPage();
    pdfText(doc, `${category.label} (${category.records.length})`, { size: 15, bold: true, color: `#${COLORS.darkBlue}` });
    doc.moveDown(0.4);
    for (const record of category.records) {
      ensurePdfSpace(doc, 80);
      doc.roundedRect(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 1, 0).fill(`#${COLORS.border}`);
      doc.moveDown(0.7);
      pdfText(doc, record.title, { size: 12.5, bold: true, color: `#${COLORS.darkBlue}` });
      for (const section of record.sections) {
        if (section.title) {
          ensurePdfSpace(doc, 24);
          doc.moveDown(0.2);
          pdfText(doc, stripEmoji(section.title).toUpperCase(), { size: 8.8, bold: true, color: `#${COLORS.blue}` });
        }
        section.rows.forEach((row) => pdfField(doc, row.label, row.value));
      }
      if (record.images?.length) {
        ensurePdfSpace(doc, 35);
        doc.moveDown(0.3);
        pdfText(doc, "Fotografia / imagem anexada", { size: 8.8, bold: true, color: `#${COLORS.blue}` });
        for (const img of record.images) {
          if (!img.ok) {
            pdfText(doc, "Fotografia não disponível", { size: 9.5, color: `#${COLORS.muted}` });
            continue;
          }
          const maxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          const maxH = 210;
          const size = fit(img.width, img.height, maxW, maxH);
          ensurePdfSpace(doc, size.height + 25);
          const x = doc.page.margins.left + (maxW - size.width) / 2;
          doc.image(img.buffer, x, doc.y + 4, { width: size.width, height: size.height });
          doc.y += size.height + 14;
        }
      }
      doc.moveDown(0.7);
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    if (i > 0) {
      doc.font("Helvetica").fontSize(8).fillColor(`#${COLORS.muted}`).text("Gestão do Turismo de Itatinga · Inventário Turístico Municipal", doc.page.margins.left, 18, { align: "right", width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
      doc.font("Helvetica").fontSize(8).fillColor(`#${COLORS.muted}`).text(`Emitido em ${formatDate()} · Página ${i + 1} de ${range.count} · inventario.turismoitatinga.com.br`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 18, { align: "center", width: doc.page.width - doc.page.margins.left - doc.page.margins.right, lineBreak: false });
    }
  }

  return {
    buffer: await pdfBuffer(doc),
    filename: downloadName("pdf", payload.mode),
    contentType: "application/pdf"
  };
}

module.exports = {
  buildReportDocx,
  buildReportPdf,
  buildReportXlsx,
  normalizeReportPayload
};
