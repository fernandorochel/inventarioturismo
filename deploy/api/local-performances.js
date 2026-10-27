"use strict";

const SLOT_STATUSES = new Set(["Planejado", "Convidado", "Confirmado", "Realizado", "Cancelado"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function shortText(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function activeMusicArtists(inventory) {
  const records = Array.isArray(inventory?.cantores_locais) ? inventory.cantores_locais : [];
  const seen = new Set();
  return records.filter(record => {
    const id = String(record?.id ?? "");
    if (record?.status !== "Ativo" || !ID_PATTERN.test(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(record => ({
    id: String(record.id),
    name: shortText(record.nome, 180) || "Artista sem nome",
    genre: shortText(record.categoria, 80) || "Sem gênero informado",
    formation: shortText(record.tipo_artista, 80)
  }));
}

function normalizedPlan(input, previous, artists) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw inputError("Dados do controle de apresentações inválidos.");
  }
  if (!Array.isArray(input.events) || input.events.length > 500) {
    throw inputError("Lista de eventos inválida ou acima do limite.");
  }
  if (!input.queues || typeof input.queues !== "object" || Array.isArray(input.queues)) {
    throw inputError("Filas por gênero inválidas.");
  }

  const artistById = new Map(artists.map(artist => [artist.id, artist]));
  const oldSlots = new Map();
  for (const event of previous?.events || []) {
    for (const slot of event.slots || []) oldSlots.set(slot.id, slot);
  }
  const eventIds = new Set();
  const slotIds = new Set();
  const events = input.events.map(event => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw inputError("Dados do evento inválidos.");
    }
    const id = String(event?.id ?? "");
    const name = shortText(event?.name, 180);
    const date = String(event?.date ?? "");
    if (!ID_PATTERN.test(id) || eventIds.has(id) || !name || (date && !validDate(date))) {
      throw inputError("Identificação, nome ou data de evento inválidos.");
    }
    eventIds.add(id);
    if (!Array.isArray(event.slots) || event.slots.length > 80) {
      throw inputError("Lista de apresentações do evento inválida.");
    }
    const slots = event.slots.map(slot => {
      const slotId = String(slot?.id ?? "");
      const artistId = String(slot?.artistId ?? "");
      const old = oldSlots.get(slotId);
      const artist = artistById.get(artistId);
      const status = String(slot?.status ?? "Planejado");
      const time = String(slot?.time ?? "");
      const duration = slot?.duration === "" || slot?.duration == null ? 0 : Number(slot.duration);
      if (!ID_PATTERN.test(slotId) || slotIds.has(slotId) || !ID_PATTERN.test(artistId) ||
          !SLOT_STATUSES.has(status) ||
          (time && (!/^\d{2}:\d{2}$/.test(time) || Number(time.slice(0, 2)) > 23 || Number(time.slice(3)) > 59)) ||
          !Number.isInteger(duration) || duration < 0 || duration > 600) {
        throw inputError("Dados de uma apresentação inválidos.");
      }
      if (old && old.artistId !== artistId) throw inputError("Não é possível trocar o artista de uma apresentação existente.");
      if (!old && !artist) throw inputError("Selecione um artista com cadastro ativo no Inventário.");
      slotIds.add(slotId);
      return {
        id: slotId,
        artistId,
        artistName: old ? old.artistName : artist.name,
        genre: old ? old.genre : artist.genre,
        time,
        duration,
        status,
        notes: shortText(slot?.notes, 1000)
      };
    });
    if (!date && slots.some(slot => slot.status === "Realizado")) {
      throw inputError("Informe a data do evento antes de registrar uma apresentação realizada.");
    }
    return {
      id,
      name,
      date,
      location: shortText(event.location, 180),
      notes: shortText(event.notes, 1200),
      slots
    };
  });
  for (const old of oldSlots.values()) {
    if (old.status === "Realizado" && !slotIds.has(old.id)) {
      throw inputError("Apresentações realizadas devem permanecer no histórico.");
    }
  }

  const genres = [...new Set(artists.map(artist => artist.genre))];
  const queues = {};
  for (const genre of genres) {
    const ids = artists.filter(artist => artist.genre === genre).map(artist => artist.id);
    const allowed = new Set(ids);
    const raw = Array.isArray(input.queues[genre]) ? input.queues[genre] : [];
    const kept = [...new Set(raw.map(String).filter(id => allowed.has(id)))];
    const missing = ids.filter(id => !kept.includes(id)).sort((a, b) =>
      artistById.get(a).name.localeCompare(artistById.get(b).name, "pt-BR"));
    queues[genre] = [...kept, ...missing];
  }

  for (const event of events) {
    for (const slot of event.slots) {
      const old = oldSlots.get(slot.id);
      const artist = artistById.get(slot.artistId);
      if (slot.status === "Realizado" && old?.status !== "Realizado" && artist) {
        const queue = queues[artist.genre];
        queues[artist.genre] = [...queue.filter(id => id !== artist.id), artist.id];
      }
    }
  }
  return { queues, events };
}

module.exports = { activeMusicArtists, normalizedPlan };
