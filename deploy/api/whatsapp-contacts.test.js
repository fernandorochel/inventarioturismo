"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { establishmentWhatsApp, contactGroups } = require("./whatsapp-contacts");

const modules = [
  { key: "restaurantes", label: "Restaurantes" },
  { key: "farmacias", label: "Farmácias" }
];

test("usa WhatsApp próprio ou explicitamente marcado no telefone", () => {
  assert.equal(establishmentWhatsApp({ whatsapp: "(14) 99818-2850", telefone: "(14) 3848-1000" }), "(14) 99818-2850");
  assert.equal(establishmentWhatsApp({ telefone: "(14) 3848-1000 / WhatsApp: (14) 99709-7363" }), "(14) 99709-7363");
  assert.equal(establishmentWhatsApp({ telefone: "(14) 99818-2850" }), "");
  assert.equal(establishmentWhatsApp({ whatsapp: "Não informado" }), "");
});

test("lista os dois contatos separadamente por segmento sem inventar WhatsApp", () => {
  const inventory = {
    restaurantes: [
      { nome: "Restaurante A", responsavel: "Ana", whatsapp: "(14) 99818-2850", resp_telefone: "(14) 99777-1111" },
      { nome: "Restaurante B", responsavel: "Beto", telefone: "(14) 3848-1000" },
      { nome: "Restaurante C", proprietario: "Carla", resp_telefone: "(14) 3848-2000" }
    ],
    farmacias: [
      { nome: "Drogaria D", telefone: "WhatsApp: (14) 99900-0000" }
    ]
  };
  const all = contactGroups(inventory, modules);
  assert.equal(all.length, 2);
  assert.deepEqual(all[0].rows, [
    { establishment: "Restaurante A", responsible: "Ana", establishmentWhatsApp: "(14) 99818-2850", responsibleContact: "(14) 99777-1111" },
    { establishment: "Restaurante C", responsible: "Carla", establishmentWhatsApp: "", responsibleContact: "(14) 3848-2000" }
  ]);
  assert.equal(contactGroups(inventory, modules, { segment: "farmacias" })[0].rows[0].establishmentWhatsApp, "(14) 99900-0000");
});
