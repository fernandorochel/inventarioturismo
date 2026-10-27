"use strict";

// Execução manual e idempotente para cadastrar os três eventos solicitados.
// Use --dry-run para conferir o resultado sem gravar no banco.
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

const requested = [
  { name: "Encontro de Carros Antigos", category: "Exposição" },
  { name: "Fórum Municipal", category: "Temático" },
  { name: "Festival Natalino", category: "Comemorativo" }
];
const normalizeName = value => String(value || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO inventory (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    await client.query("INSERT INTO local_performances (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    const inventoryRow = await client.query("SELECT data FROM inventory WHERE id=1 FOR UPDATE");
    const controlRow = await client.query("SELECT data FROM local_performances WHERE id=1 FOR UPDATE");
    const inventory = inventoryRow.rows[0].data || {};
    const control = controlRow.rows[0].data || {};
    if (!Array.isArray(inventory.eventos)) inventory.eventos = [];
    if (!Array.isArray(control.events)) control.events = [];
    if (!control.queues || typeof control.queues !== "object") control.queues = {};

    let inventoryChanged = false;
    let controlChanged = false;
    const results = [];
    for (const item of requested) {
      const matches = inventory.eventos.filter(event => normalizeName(event.nome) === normalizeName(item.name));
      if (matches.length > 1) throw new Error(`Há fichas duplicadas no Inventário para ${item.name}.`);
      let record = matches[0];
      const inventoryAction = record ? "reutilizada" : "criada";
      if (!record) {
        record = {
          id: `eventos-${Date.now()}-${randomUUID().slice(0, 8)}`,
          nome: item.name,
          categoria: item.category,
          status: "Ativo",
          publicar_guia: "Não"
        };
        inventory.eventos.push(record);
        inventoryChanged = true;
      }

      const linked = control.events.filter(event => event.inventoryEventId === record.id);
      if (linked.length > 1) throw new Error(`Há programações duplicadas vinculadas a ${item.name}.`);
      let plan = linked[0];
      let controlAction = "reutilizada";
      if (!plan) {
        const byName = control.events.filter(event => !event.inventoryEventId && normalizeName(event.name) === normalizeName(item.name));
        if (byName.length > 1) throw new Error(`Há programações sem vínculo duplicadas para ${item.name}.`);
        plan = byName[0];
        if (plan) {
          plan.inventoryEventId = record.id;
          controlAction = "vinculada";
        } else {
          plan = {
            id: `evt-${randomUUID()}`,
            inventoryEventId: record.id,
            name: record.nome,
            date: "",
            location: "",
            notes: "",
            slots: []
          };
          control.events.push(plan);
          controlAction = "criada";
        }
        controlChanged = true;
      }
      results.push({ event: record.nome, category: record.categoria, inventoryAction, controlAction, inventoryId: record.id, planId: plan.id, scheduledArtists: plan.slots?.length || 0 });
    }

    if (inventoryChanged) {
      await client.query("UPDATE inventory SET data=$1::jsonb, updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=1", [JSON.stringify(inventory)]);
    }
    if (controlChanged) {
      await client.query("UPDATE local_performances SET data=$1::jsonb, updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=1", [JSON.stringify(control)]);
    }
    if (inventoryChanged || controlChanged) {
      for (const result of results) {
        if (result.inventoryAction === "reutilizada" && result.controlAction === "reutilizada") continue;
        await client.query(
          "INSERT INTO audit_log (user_id, user_name, acao, modulo, nome) VALUES ($1,$2,$3,$4,$5)",
          ["codex", "Assistente sob solicitação de Fernando Rochel", "Cadastro e vínculo", "Eventos / Controle de Apresentações Locais", result.event]
        );
      }
    }
    if (dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    console.log(JSON.stringify({ dryRun, inventoryChanged, controlChanged, results }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
