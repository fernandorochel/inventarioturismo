"use strict";

function clean(value, limit = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function phoneText(value) {
  const result = clean(value);
  return result.replace(/\D/g, "").length >= 8 ? result : "";
}

function establishmentWhatsApp(record) {
  const explicit = phoneText(record.whatsapp);
  if (explicit) return explicit;
  const phone = clean(record.telefone, 300);
  const labeled = phone.match(/whats(?:app)?\s*[:\-]?\s*(\+?[\d(][\d\s().-]{7,25})/i);
  return labeled && labeled[1].replace(/\D/g, "").length >= 10 ? clean(labeled[1]) : "";
}

function contactGroups(inventory, modules, filters = {}) {
  const selected = filters.segment || "";
  const category = clean(filters.category, 80);
  const status = clean(filters.status, 40);
  return modules.filter(module => !selected || module.key === selected).map(module => {
    const records = Array.isArray(inventory[module.key]) ? inventory[module.key] : [];
    const rows = records.filter(record =>
      record && typeof record === "object" &&
      (!category || clean(record.categoria, 80) === category) &&
      (!status || clean(record.status, 40) === status)
    ).map(record => ({
      establishment: clean(record.nome),
      responsible: clean(record.responsavel || record.artesao_nome || record.proprietario || record.contato_nome || record.orgao_resp),
      establishmentWhatsApp: establishmentWhatsApp(record),
      responsibleContact: phoneText(record.resp_telefone)
    })).filter(row => row.establishmentWhatsApp || row.responsibleContact);
    return { key: module.key, label: module.label, rows };
  }).filter(group => group.rows.length);
}

async function buildWhatsAppPdf(groups, segment) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, autoFirstPage: false });
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const ink = "#16375F";
  const muted = "#617085";
  const left = 42;
  const width = 511;
  const bottom = 765;
  const columns = [155, 128, 105, 123];
  const headers = ["Estabelecimento", "Responsável", "WhatsApp do estabelecimento", "Telefone/WhatsApp do responsável"];
  const fields = ["establishment", "responsible", "establishmentWhatsApp", "responsibleContact"];
  const emittedAt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric"
  }).format(new Date());

  function pageHeader() {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(ink)
      .text("PREFEITURA DE ITATINGA  |  DIRETORIA DE LAZER, TURISMO E EVENTOS", left, 30, { width });
    doc.font("Helvetica-Bold").fontSize(17).text("Contatos de WhatsApp por segmento", left, 47, { width });
    doc.font("Helvetica").fontSize(8.5).fillColor(muted)
      .text(`Inventário Municipal de Turismo  |  Uso interno  |  ${emittedAt}`, left, 74, { width });
    let x = left;
    for (const [fraction, color] of [[.28, "#0B63B6"], [.18, "#10A8E8"], [.18, "#66C943"], [.18, "#F58220"], [.18, "#FDB515"]]) {
      const part = width * fraction;
      doc.rect(x, 94, part, 4).fill(color);
      x += part;
    }
    doc.y = 110;
  }
  function addPage() {
    doc.addPage();
    pageHeader();
  }
  function tableHeader(y) {
    doc.rect(left, y, width, 34).fill(ink);
    let x = left;
    for (let index = 0; index < columns.length; index++) {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF")
        .text(headers[index], x + 6, y + 7, { width: columns[index] - 12, height: 25, ellipsis: true });
      x += columns[index];
    }
    return y + 34;
  }
  function groupHeading(group, continued = false) {
    const heading = `${group.label}${continued ? " (continuação)" : ""}`;
    const headingHeight = Math.max(23, doc.font("Helvetica-Bold").fontSize(12)
      .heightOfString(heading, { width: width - 92 }) + 8);
    const spacer = doc.y > 111 ? 13 : 0;
    if (doc.y + spacer + headingHeight + 34 + 32 > bottom) addPage();
    const y = doc.y + (doc.y > 111 ? 13 : 0);
    doc.roundedRect(left, y, width, headingHeight, 5).fill("#EAF2FA");
    doc.font("Helvetica-Bold").fontSize(12).fillColor(ink)
      .text(heading, left + 8, y + 5, { width: width - 92, height: headingHeight - 6 });
    doc.font("Helvetica").fontSize(8).fillColor(muted)
      .text(`${group.rows.length} contato(s)`, left + width - 82, y + 7, { width: 74, align: "right" });
    doc.y = tableHeader(y + headingHeight + 2);
  }
  function rowHeight(row) {
    doc.font("Helvetica").fontSize(8.4);
    return Math.max(28, ...fields.map((field, index) =>
      doc.heightOfString(row[field] || "-", { width: columns[index] - 12 }) + 12));
  }
  function drawRow(row, index, height) {
    const y = doc.y;
    doc.rect(left, y, width, height).fill(index % 2 ? "#F5F8FC" : "#FFFFFF");
    doc.moveTo(left, y + height).lineTo(left + width, y + height).strokeColor("#DCE5EF").lineWidth(.45).stroke();
    let x = left;
    fields.forEach((field, column) => {
      doc.font("Helvetica").fontSize(8.4).fillColor("#243044")
        .text(row[field] || "-", x + 6, y + 6, { width: columns[column] - 12, height: height - 11, ellipsis: true });
      x += columns[column];
    });
    doc.y = y + height;
  }

  addPage();
  for (const group of groups) {
    groupHeading(group);
    group.rows.forEach((row, index) => {
      const height = rowHeight(row);
      if (doc.y + height > bottom) {
        addPage();
        groupHeading(group, true);
      }
      drawRow(row, index, height);
    });
  }
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    doc.moveTo(left, 786).lineTo(left + width, 786).strokeColor("#DCE5EF").lineWidth(.5).stroke();
    doc.font("Helvetica").fontSize(7.7).fillColor(muted)
      .text(`Uso interno  |  Página ${page + 1} de ${range.count}`, left, 790, { width, align: "right", lineBreak: false });
  }
  doc.end();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    buffer: await finished,
    filename: `contatos-whatsapp-${segment || "todos-os-segmentos"}-${date}.pdf`,
    contentType: "application/pdf"
  };
}

module.exports = { establishmentWhatsApp, contactGroups, buildWhatsAppPdf };
