"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { activeMusicArtists, normalizedPlan } = require("./local-performances");

const inventory = {
  cantores_locais: [
    { id: "a1", nome: "Ana", categoria: "MPB", status: "Ativo", publicar_guia: "Não" },
    { id: "a2", nome: "Beto", categoria: "MPB", status: "Ativo" },
    { id: "p1", nome: "Pendente", categoria: "MPB", status: "Pendente" }
  ]
};
const artists = activeMusicArtists(inventory);

test("usa artistas aprovados mesmo sem publicação no Guia e exclui pendentes", () => {
  assert.deepEqual(artists.map(artist => artist.id), ["a1", "a2"]);
});

test("registra apresentação e move para o fim da fila somente após realização", () => {
  const event = {
    id: "evt-1", name: "Festival", date: "2026-11-10", location: "Praça", notes: "",
    slots: [{ id: "apr-1", artistId: "a1", time: "19:30", duration: 45, status: "Planejado", notes: "" }]
  };
  const planned = normalizedPlan({ queues: { MPB: ["a1", "a2"] }, events: [event] }, { events: [] }, artists);
  assert.deepEqual(planned.queues.MPB, ["a1", "a2"]);
  assert.equal(planned.events[0].slots[0].artistName, "Ana");
  event.slots[0].status = "Realizado";
  const completed = normalizedPlan({ queues: planned.queues, events: [event] }, planned, artists);
  assert.deepEqual(completed.queues.MPB, ["a2", "a1"]);
  const savedAgain = normalizedPlan(completed, completed, artists);
  assert.deepEqual(savedAgain.queues.MPB, ["a2", "a1"]);
});

test("impede novo agendamento de cadastro pendente e preserva o nome histórico", () => {
  const base = { queues: {}, events: [{ id: "evt-1", name: "Festival", date: "2026-11-10", slots: [] }] };
  const pending = structuredClone(base);
  pending.events[0].slots.push({ id: "apr-2", artistId: "p1", status: "Planejado" });
  assert.throws(() => normalizedPlan(pending, base, artists), /cadastro ativo/);

  const former = structuredClone(base);
  former.events[0].slots.push({ id: "apr-3", artistId: "a1", artistName: "Nome antigo", genre: "MPB", status: "Planejado" });
  const renamedArtists = [{ ...artists[0], name: "Nome novo" }, artists[1]];
  const result = normalizedPlan(former, former, renamedArtists);
  assert.equal(result.events[0].slots[0].artistName, "Nome antigo");
});

test("não apaga uma apresentação já realizada do histórico", () => {
  const previous = normalizedPlan({
    queues: {},
    events: [{ id: "evt-1", name: "Festival", date: "2026-11-10", slots: [
      { id: "apr-1", artistId: "a1", status: "Realizado" }
    ] }]
  }, { events: [] }, artists);
  assert.throws(() => normalizedPlan({ queues: previous.queues, events: [] }, previous, artists), /histórico/);
});

test("permite planejar sem data, mas exige data para registrar realização", () => {
  const draft = { queues: {}, events: [{ id: "evt-sem-data", name: "Evento em estudo", date: "", slots: [] }] };
  assert.equal(normalizedPlan(draft, { events: [] }, artists).events[0].date, "");
  draft.events[0].slots.push({ id: "apr-sem-data", artistId: "a1", status: "Realizado" });
  assert.throws(() => normalizedPlan(draft, { events: [] }, artists), /data do evento/);
});
