/* Controle operacional separado, com vínculos às fichas do Inventário Municipal. */
const LP = { data: { queues: {}, events: [] }, version: "", artists: [], inventoryEvents: [], tab: "fila", genre: "", historyGenre: "Todos", eventId: "", requestedInventoryEventId: "", form: null, busy: false };
const LP_STATUSES = ["Planejado", "Convidado", "Confirmado", "Realizado", "Cancelado"];

function lpEsc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function lpCopy() { return JSON.parse(JSON.stringify(LP.data)); }
function lpDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value.split("-").reverse().join("/") : "Data a definir"; }
function lpGenres() { return [...new Set(LP.artists.map(a => a.genre))].sort((a, b) => a.localeCompare(b, "pt-BR")); }
function lpArtist(id) { return LP.artists.find(a => a.id === id); }
function lpEvent(id) { return LP.data.events.find(e => e.id === id); }
function lpInventoryEvent(id) { return LP.inventoryEvents.find(e => e.id === id); }
function lpOpenFromInventory(id) {
  LP.requestedInventoryEventId = id;
  LP.tab = "eventos";
  go("apresentacoes_locais");
}
function lpQueue(genre) {
  const artists = LP.artists.filter(a => a.genre === genre);
  const byId = new Map(artists.map(a => [a.id, a]));
  const saved = (LP.data.queues[genre] || []).filter(id => byId.has(id));
  const extra = artists.filter(a => !saved.includes(a.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(a => a.id);
  return [...saved, ...extra];
}
function lpHistory() {
  const rows = [];
  for (const event of LP.data.events) {
    for (const slot of event.slots || []) {
      if (slot.status === "Realizado") rows.push({ event, slot });
    }
  }
  return rows.sort((a, b) => b.event.date.localeCompare(a.event.date) || a.event.name.localeCompare(b.event.name, "pt-BR"));
}
function lpArtistHistory(id) {
  const rows = lpHistory().filter(x => x.slot.artistId === id);
  return { count: rows.length, last: rows[0]?.event.date || "" };
}
function lpButton(action, label, attrs = "", extraClass = "") {
  return `<button type="button" class="lp-small ${extraClass}" data-lp-action="${action}" ${attrs}>${label}</button>`;
}

async function renderLocalPerformances() {
  document.getElementById("main").innerHTML = `<div class="crumb">Gestão interna › Apresentações locais</div><div class="page-head"><div><h2>🎤 Controle de Apresentações Locais</h2><p>Carregando planejamento...</p></div></div>`;
  try {
    const response = await fetch("/api/local-performances?ts=" + Date.now(), { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "Não foi possível carregar o controle.");
    LP.data = json.data || { queues: {}, events: [] };
    if (!LP.data.queues || typeof LP.data.queues !== "object") LP.data.queues = {};
    if (!Array.isArray(LP.data.events)) LP.data.events = [];
    LP.version = json.version || "";
    LP.artists = json.artists || [];
    LP.inventoryEvents = json.inventoryEvents || [];
    if (LP.requestedInventoryEventId) {
      const id = LP.requestedInventoryEventId;
      LP.requestedInventoryEventId = "";
      LP.eventId = LP.data.events.find(event => event.inventoryEventId === id)?.id || "";
      const hasPlan = Boolean(LP.eventId);
      if (currentView === "apresentacoes_locais") {
        lpRender();
        if (!hasPlan && canEdit()) lpOpenEventForm("", id);
      }
    } else if (currentView === "apresentacoes_locais") lpRender();
  } catch (error) {
    if (currentView === "apresentacoes_locais") {
      document.getElementById("main").innerHTML = `<div class="crumb">Gestão interna › Apresentações locais</div><div class="page-head"><div><h2>🎤 Controle de Apresentações Locais</h2></div></div><div class="lp-note">${lpEsc(error.message)}</div><button class="btn btn-sm" data-lp-action="reload">Tentar novamente</button>`;
    }
  }
}

function lpRender() {
  const genres = lpGenres();
  if (!genres.includes(LP.genre)) LP.genre = genres[0] || "";
  const scheduled = LP.data.events.reduce((n, e) => n + (e.slots || []).filter(s => s.status !== "Cancelado" && s.status !== "Realizado").length, 0);
  const completed = lpHistory().length;
  const tabs = [["fila", "Fila por gênero"], ["eventos", "Programação por evento"], ["historico", "Histórico"]];
  const main = document.getElementById("main");
  main.innerHTML = `<div class="crumb">Gestão interna › Apresentações locais</div>
    <div class="page-head"><div><h2>🎤 Controle de Apresentações Locais</h2><p>Planejamento e acompanhamento de artistas do município</p></div></div>
    <div class="lp-note">Esta é uma ferramenta de <b>gestão interna</b>. Ela vincula eventos e consulta artistas musicais com cadastro <b>Ativo</b> no Inventário. Incluir um artista na programação não representa contratação nem confirma sua apresentação.</div>
    <div class="lp-stats"><div class="lp-stat"><strong>${LP.artists.length}</strong><span>artistas aprovados disponíveis</span></div><div class="lp-stat"><strong>${scheduled}</strong><span>apresentações em planejamento</span></div><div class="lp-stat"><strong>${completed}</strong><span>apresentações realizadas registradas</span></div></div>
    <div class="lp-tabs" role="tablist" aria-label="Controle de apresentações">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${LP.tab === id}" class="lp-tab ${LP.tab === id ? "active" : ""}" data-lp-action="tab" data-tab="${id}">${label}</button>`).join("")}</div>
    ${LP.tab === "fila" ? lpRenderQueue(genres) : LP.tab === "eventos" ? lpRenderEvents() : lpRenderHistory(genres)}`;
}

function lpRenderQueue(genres) {
  if (!genres.length) return `<div class="lp-panel"><div class="lp-empty">Ainda não há artistas musicais com cadastro ativo. Após a aprovação no Inventário, eles aparecerão aqui.</div></div>`;
  const ids = lpQueue(LP.genre);
  return `<div class="lp-toolbar"><label>Gênero musical<select data-lp-change="genre">${genres.map(g => `<option value="${lpEsc(g)}" ${g === LP.genre ? "selected" : ""}>${lpEsc(g)}</option>`).join("")}</select></label><span class="lp-muted">A ordem pode ser ajustada manualmente. Ao marcar uma apresentação como realizada, o artista vai para o fim da fila do gênero.</span></div>
    <div class="lp-panel"><div class="lp-panel-head"><div><h3>${lpEsc(LP.genre)}</h3><p>${ids.length} artista(s) nesta fila</p></div></div>
    <div class="lp-tablewrap"><table class="lp-table"><thead><tr><th>Ordem</th><th>Artista</th><th>Formação</th><th>Última apresentação registrada</th><th>Realizadas</th>${canEdit() ? "<th>Ações</th>" : ""}</tr></thead><tbody>
    ${ids.map((id, index) => { const artist = lpArtist(id); const history = lpArtistHistory(id); return `<tr><td><strong>${index + 1}º</strong></td><td><strong>${lpEsc(artist.name)}</strong></td><td>${lpEsc(artist.formation || "—")}</td><td>${history.last ? lpDate(history.last) : '<span class="lp-muted">Sem registro neste controle</span>'}</td><td>${history.count}</td>${canEdit() ? `<td><span class="lp-actions">${lpButton("queue-up", "↑", `data-genre="${lpEsc(LP.genre)}" data-id="${lpEsc(id)}" aria-label="Subir ${lpEsc(artist.name)}" ${index === 0 ? "disabled" : ""}`)}${lpButton("queue-down", "↓", `data-genre="${lpEsc(LP.genre)}" data-id="${lpEsc(id)}" aria-label="Descer ${lpEsc(artist.name)}" ${index === ids.length - 1 ? "disabled" : ""}`)}</span></td>` : ""}</tr>`; }).join("")}
    </tbody></table></div></div>`;
}

function lpRenderEvents() {
  const events = [...LP.data.events];
  if (!events.some(e => e.id === LP.eventId)) LP.eventId = events[0]?.id || "";
  const selected = lpEvent(LP.eventId);
  return `<div class="lp-toolbar"><div class="lp-muted">Selecione um evento do Inventário, informe a data quando definida e monte a ordem das apresentações.</div>${canEdit() ? `<button class="btn btn-sm" data-lp-action="new-event">+ Novo evento</button>` : ""}</div>
    ${events.length ? `<div class="lp-events"><div class="lp-event-list">${events.map(e => `<button type="button" class="lp-event-item ${e.id === LP.eventId ? "active" : ""}" data-lp-action="select-event" data-event-id="${lpEsc(e.id)}"><strong>${lpEsc(e.name)}</strong><span>${lpDate(e.date)} · ${(e.slots || []).length} apresentação(ões)</span></button>`).join("")}</div><div class="lp-event-detail">${lpRenderEventDetail(selected)}</div></div>` : `<div class="lp-panel"><div class="lp-empty">Nenhum evento no controle. Use “Novo evento” para começar a programação.</div></div>`}`;
}

function lpRenderEventDetail(event) {
  if (!event) return "";
  const source = lpInventoryEvent(event.inventoryEventId);
  return `<div class="lp-panel"><div class="lp-panel-head"><div><h3>${lpEsc(event.name)}</h3><div class="lp-event-meta"><span>📅 ${lpDate(event.date)}</span>${event.location ? `<span>📍 ${lpEsc(event.location)}</span>` : ""}${event.inventoryEventId ? `<span>📚 Inventário: ${lpEsc(source?.name || "Ficha não localizada")}${source?.category ? ` · ${lpEsc(source.category)}` : ""}</span>` : `<span>Sem vínculo com o Inventário</span>`}</div></div><div class="lp-actions">${source ? lpButton("open-inventory-event", "Ver ficha", `data-inventory-event-id="${lpEsc(source.id)}"`) : ""}${canEdit() ? `${lpButton("edit-event", "Editar evento", `data-event-id="${lpEsc(event.id)}"`)}${!event.slots.length ? lpButton("delete-event", "Remover do controle", `data-event-id="${lpEsc(event.id)}"`, "danger") : ""}` : ""}</div></div>
    ${event.notes ? `<div class="lp-event-note">${lpEsc(event.notes)}</div>` : ""}
    <div class="lp-panel-head"><div><h3>Sequência de apresentações</h3><p>${event.slots.length} item(ns) na programação</p></div>${canEdit() && LP.artists.length ? `<button class="btn btn-sm" data-lp-action="new-slot" data-event-id="${lpEsc(event.id)}">+ Adicionar apresentação</button>` : ""}</div>
    ${event.slots.length ? `<div class="lp-tablewrap"><table class="lp-table"><thead><tr><th>Ordem</th><th>Horário</th><th>Artista</th><th>Gênero</th><th>Situação</th>${canEdit() ? "<th>Ações</th>" : ""}</tr></thead><tbody>${event.slots.map((slot, index) => `<tr><td><strong>${index + 1}º</strong></td><td>${lpEsc(slot.time || "—")}${slot.duration ? `<div class="lp-muted">${slot.duration} min</div>` : ""}</td><td><strong>${lpEsc(slot.artistName)}</strong>${slot.notes ? `<div class="lp-muted">${lpEsc(slot.notes)}</div>` : ""}</td><td>${lpEsc(slot.genre)}</td><td><span class="lp-status ${lpEsc(slot.status.toLowerCase())}">${lpEsc(slot.status)}</span></td>${canEdit() ? `<td><span class="lp-actions">${lpButton("slot-up", "↑", `data-event-id="${lpEsc(event.id)}" data-slot-id="${lpEsc(slot.id)}" aria-label="Subir apresentação" ${index === 0 ? "disabled" : ""}`)}${lpButton("slot-down", "↓", `data-event-id="${lpEsc(event.id)}" data-slot-id="${lpEsc(slot.id)}" aria-label="Descer apresentação" ${index === event.slots.length - 1 ? "disabled" : ""}`)}${lpButton("edit-slot", "Editar", `data-event-id="${lpEsc(event.id)}" data-slot-id="${lpEsc(slot.id)}"`)}${slot.status !== "Realizado" ? lpButton("delete-slot", "Remover", `data-event-id="${lpEsc(event.id)}" data-slot-id="${lpEsc(slot.id)}"`, "danger") : ""}</span></td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<div class="lp-empty">Ainda não há apresentações neste evento. Selecione artistas aprovados para montar a sequência.</div>`}</div>`;
}

function lpRenderHistory(genres) {
  const historicalGenres = [...new Set([...genres, ...lpHistory().map(x => x.slot.genre)])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const rows = lpHistory().filter(x => LP.historyGenre === "Todos" || x.slot.genre === LP.historyGenre);
  return `<div class="lp-toolbar"><label>Gênero musical<select data-lp-change="history-genre"><option value="Todos">Todos</option>${historicalGenres.map(g => `<option value="${lpEsc(g)}" ${g === LP.historyGenre ? "selected" : ""}>${lpEsc(g)}</option>`).join("")}</select></label><span class="lp-muted">Histórico das apresentações marcadas como realizadas neste controle.</span></div><div class="lp-panel">${rows.length ? `<div class="lp-tablewrap"><table class="lp-table"><thead><tr><th>Data</th><th>Evento</th><th>Artista</th><th>Gênero</th></tr></thead><tbody>${rows.map(({ event, slot }) => `<tr><td>${lpDate(event.date)}</td><td><strong>${lpEsc(event.name)}</strong></td><td>${lpEsc(slot.artistName)}</td><td>${lpEsc(slot.genre)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="lp-empty">Nenhuma apresentação realizada registrada para este filtro.</div>`}</div>`;
}

async function lpSave(next, auditName) {
  if (!canEdit() || LP.busy) return false;
  LP.busy = true;
  try {
    const response = await fetch("/api/local-performances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: next, baseVersion: LP.version, auditName }) });
    const json = await response.json().catch(() => ({}));
    if (response.status === 409) {
      closeModal(true);
      await renderLocalPerformances();
      toast(json.error || "O controle foi alterado. Dados atualizados; refaça a edição.");
      return false;
    }
    if (!response.ok) throw new Error(json.error || "Não foi possível salvar.");
    LP.data = json.data;
    LP.version = json.version;
    LP.artists = json.artists || LP.artists;
    LP.inventoryEvents = json.inventoryEvents || LP.inventoryEvents;
    closeModal(true);
    lpRender();
    toast("Controle salvo.");
    return true;
  } catch (error) {
    toast(error.message || "Erro de conexão ao salvar.");
    return false;
  } finally {
    LP.busy = false;
  }
}

function lpOpenEventForm(eventId, selectedInventoryEventId = "") {
  if (!canEdit()) return;
  const event = lpEvent(eventId);
  const inventoryEventId = event?.inventoryEventId || selectedInventoryEventId;
  const selected = lpInventoryEvent(inventoryEventId);
  LP.form = { type: "event", eventId: eventId || "" };
  modal(event ? "Editar evento" : "Novo evento", `<div class="lp-form"><label class="wide">Evento do Inventário Municipal<select id="lpInventoryEvent" data-lp-change="inventory-event"><option value="">Sem vínculo</option>${LP.inventoryEvents.map(item => `<option value="${lpEsc(item.id)}" ${item.id === inventoryEventId ? "selected" : ""}>${lpEsc(item.name)}${item.category ? ` · ${lpEsc(item.category)}` : ""}</option>`).join("")}</select></label><label class="wide">Nome desta programação<input id="lpEventName" maxlength="180" value="${lpEsc(event?.name || selected?.name || "")}" required></label><label>Data da edição (se definida)<input id="lpEventDate" type="date" value="${lpEsc(event?.date || "")}"></label><label>Local<input id="lpEventLocation" maxlength="180" value="${lpEsc(event?.location || "")}"></label><label class="wide">Observações internas<textarea id="lpEventNotes" maxlength="1200">${lpEsc(event?.notes || "")}</textarea></label></div>`, `<button class="btn btn-sm" data-lp-action="save-event">Salvar evento</button>`);
  document.getElementById("lpEventName")?.focus();
}
async function lpSaveEvent() {
  if (LP.form?.type !== "event") return;
  const name = document.getElementById("lpEventName").value.trim();
  const date = document.getElementById("lpEventDate").value;
  if (!name) return toast("Informe o nome do evento.");
  const next = lpCopy();
  const existing = next.events.find(e => e.id === LP.form.eventId);
  const event = existing || { id: "evt-" + crypto.randomUUID(), slots: [] };
  event.name = name;
  event.inventoryEventId = document.getElementById("lpInventoryEvent").value;
  event.date = date;
  event.location = document.getElementById("lpEventLocation").value.trim();
  event.notes = document.getElementById("lpEventNotes").value.trim();
  if (!existing) next.events.push(event);
  LP.eventId = event.id;
  LP.tab = "eventos";
  await lpSave(next, `${existing ? "Evento editado" : "Evento criado"}: ${name}`);
}

function lpArtistOptions(genre) {
  return lpQueue(genre).map(id => lpArtist(id)).filter(Boolean).map(artist => `<option value="${lpEsc(artist.id)}">${lpEsc(artist.name)}</option>`).join("");
}
function lpOpenSlotForm(eventId, slotId) {
  if (!canEdit()) return;
  const event = lpEvent(eventId);
  const slot = event?.slots.find(s => s.id === slotId);
  if (!event) return;
  const genres = lpGenres();
  if (!slot && !genres.length) return toast("Aprove ao menos um artista no Inventário antes de programar.");
  const genre = slot?.genre || (genres.includes(LP.genre) ? LP.genre : genres[0]);
  LP.form = { type: "slot", eventId, slotId: slotId || "" };
  const artistFields = slot ? `<div class="wide"><strong>${lpEsc(slot.artistName)}</strong><div class="lp-muted">${lpEsc(slot.genre)} · cadastro vinculado ao Inventário</div></div>` : `<label>Gênero musical<select id="lpSlotGenre" data-lp-change="slot-genre">${genres.map(g => `<option value="${lpEsc(g)}" ${g === genre ? "selected" : ""}>${lpEsc(g)}</option>`).join("")}</select></label><label>Artista aprovado<select id="lpSlotArtist">${lpArtistOptions(genre)}</select></label>`;
  modal(slot ? "Editar apresentação" : "Adicionar apresentação", `<div class="lp-form">${artistFields}<label>Horário previsto<input id="lpSlotTime" type="time" value="${lpEsc(slot?.time || "")}"></label><label>Duração prevista (minutos)<input id="lpSlotDuration" type="number" min="0" max="600" value="${slot?.duration || ""}"></label><label class="wide">Situação<select id="lpSlotStatus">${LP_STATUSES.map(status => `<option ${status === (slot?.status || "Planejado") ? "selected" : ""}>${status}</option>`).join("")}</select></label><label class="wide">Observações internas<textarea id="lpSlotNotes" maxlength="1000">${lpEsc(slot?.notes || "")}</textarea></label></div>`, `<button class="btn btn-sm" data-lp-action="save-slot">Salvar apresentação</button>`);
}
async function lpSaveSlot() {
  if (LP.form?.type !== "slot") return;
  const next = lpCopy();
  const event = next.events.find(e => e.id === LP.form.eventId);
  if (!event) return toast("Evento não encontrado.");
  const existing = event.slots.find(s => s.id === LP.form.slotId);
  const artist = existing ? lpArtist(existing.artistId) : lpArtist(document.getElementById("lpSlotArtist")?.value);
  if (!existing && !artist) return toast("Selecione um artista aprovado.");
  const durationText = document.getElementById("lpSlotDuration").value;
  const duration = durationText ? Number(durationText) : 0;
  if (!Number.isInteger(duration) || duration < 0 || duration > 600) return toast("Informe uma duração de até 600 minutos.");
  const slot = existing || { id: "apr-" + crypto.randomUUID(), artistId: artist.id, artistName: artist.name, genre: artist.genre };
  slot.time = document.getElementById("lpSlotTime").value;
  slot.duration = duration;
  slot.status = document.getElementById("lpSlotStatus").value;
  slot.notes = document.getElementById("lpSlotNotes").value.trim();
  if (!existing) event.slots.push(slot);
  LP.tab = "eventos";
  await lpSave(next, `Apresentação ${existing ? "editada" : "incluída"}: ${slot.artistName} / ${event.name}`);
}

async function lpMoveQueue(genre, id, direction) {
  const next = lpCopy();
  const queue = lpQueue(genre);
  const index = queue.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= queue.length) return;
  [queue[index], queue[target]] = [queue[target], queue[index]];
  next.queues[genre] = queue;
  await lpSave(next, `Fila ${genre}: ${lpArtist(id)?.name || id}`);
}
async function lpMoveSlot(eventId, slotId, direction) {
  const next = lpCopy();
  const event = next.events.find(e => e.id === eventId);
  const index = event?.slots.findIndex(s => s.id === slotId) ?? -1;
  const target = index + direction;
  if (!event || index < 0 || target < 0 || target >= event.slots.length) return;
  [event.slots[index], event.slots[target]] = [event.slots[target], event.slots[index]];
  await lpSave(next, `Sequência alterada: ${event.name}`);
}
async function lpDeleteSlot(eventId, slotId) {
  const next = lpCopy();
  const event = next.events.find(e => e.id === eventId);
  const slot = event?.slots.find(s => s.id === slotId);
  if (!slot || slot.status === "Realizado") return;
  if (!window.confirm(`Remover ${slot.artistName} da programação de ${event.name}?`)) return;
  event.slots = event.slots.filter(s => s.id !== slotId);
  await lpSave(next, `Apresentação removida: ${slot.artistName} / ${event.name}`);
}
async function lpDeleteEvent(eventId) {
  const next = lpCopy();
  const event = next.events.find(e => e.id === eventId);
  if (!event || event.slots.length) return;
  if (!window.confirm(`Remover “${event.name}” deste controle? A ficha no Inventário permanecerá.`)) return;
  next.events = next.events.filter(e => e.id !== eventId);
  LP.eventId = "";
  await lpSave(next, `Evento vazio excluído: ${event.name}`);
}

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-lp-action]");
  if (!button) return;
  const action = button.dataset.lpAction;
  const eventId = button.dataset.eventId;
  const slotId = button.dataset.slotId;
  if (action === "reload") return renderLocalPerformances();
  if (action === "tab") { LP.tab = button.dataset.tab; lpRender(); return; }
  if (action === "select-event") { LP.eventId = eventId; lpRender(); return; }
  if (action === "open-inventory-event") { go("eventos"); openDetail("eventos", button.dataset.inventoryEventId); return; }
  if (!canEdit()) return;
  if (action === "new-event") return lpOpenEventForm("");
  if (action === "edit-event") return lpOpenEventForm(eventId);
  if (action === "save-event") return lpSaveEvent();
  if (action === "delete-event") return lpDeleteEvent(eventId);
  if (action === "new-slot" || action === "edit-slot") return lpOpenSlotForm(eventId, slotId);
  if (action === "save-slot") return lpSaveSlot();
  if (action === "delete-slot") return lpDeleteSlot(eventId, slotId);
  if (action === "slot-up" || action === "slot-down") return lpMoveSlot(eventId, slotId, action === "slot-up" ? -1 : 1);
  if (action === "queue-up" || action === "queue-down") return lpMoveQueue(button.dataset.genre, button.dataset.id, action === "queue-up" ? -1 : 1);
});
document.addEventListener("change", event => {
  const type = event.target.dataset.lpChange;
  if (type === "genre") { LP.genre = event.target.value; lpRender(); }
  if (type === "history-genre") { LP.historyGenre = event.target.value; lpRender(); }
  if (type === "inventory-event" && LP.form?.type === "event" && !LP.form.eventId) {
    const name = document.getElementById("lpEventName");
    const selected = lpInventoryEvent(event.target.value);
    if (name && selected) name.value = selected.name;
  }
  if (type === "slot-genre") {
    const artistSelect = document.getElementById("lpSlotArtist");
    if (artistSelect) artistSelect.innerHTML = lpArtistOptions(event.target.value);
  }
});
