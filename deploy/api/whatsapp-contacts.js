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

function safeSheetName(label, index) {
  const name = clean(label, 80).replace(/[\\/?*\[\]:]/g, "");
  return `${String(index + 1).padStart(2, "0")} ${name}`.slice(0, 31);
}

async function buildWhatsAppWorkbook(groups, segment) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Gestão do Turismo de Itatinga";
  workbook.created = new Date();
  for (const [index, group] of groups.entries()) {
    const sheet = workbook.addWorksheet(safeSheetName(group.label, index), {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    sheet.columns = [
      { header: "Nome do estabelecimento", key: "establishment", width: 38 },
      { header: "Nome do responsável", key: "responsible", width: 34 },
      { header: "WhatsApp do estabelecimento", key: "establishmentWhatsApp", width: 28 },
      { header: "Telefone/WhatsApp do responsável", key: "responsibleContact", width: 30 }
    ];
    group.rows.forEach(row => sheet.addRow(row));
    sheet.autoFilter = { from: "A1", to: `D${sheet.rowCount}` };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF062F5F" } };
    sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(1).height = 32;
    for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
      sheet.getRow(rowIndex).alignment = { vertical: "top", wrapText: true };
      sheet.getCell(rowIndex, 3).numFmt = "@";
      sheet.getCell(rowIndex, 4).numFmt = "@";
    }
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    filename: `contatos-whatsapp-${segment || "todos-os-segmentos"}-${date}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
}

module.exports = { establishmentWhatsApp, contactGroups, buildWhatsAppWorkbook };
