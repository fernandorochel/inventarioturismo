// ============================================================
// Gestão do Turismo de Itatinga — API Backend
// Node.js + Express + PostgreSQL
// ============================================================
"use strict";

const express    = require("express");
const { Pool }   = require("pg");
const bcrypt     = require("bcryptjs");
const session    = require("express-session");
const PgSession  = require("connect-pg-simple")(session);
const path       = require("path");

const app  = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// ── Middlewares ──────────────────────────────────────────────
app.use(express.json({ limit: "50mb" }));

app.use(session({
  store: new PgSession({ pool, tableName: "sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "fallback-dev-secret-mude-em-producao",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 }
}));

// Serve os arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, "..", "web")));

// ── Guards ───────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Não autenticado" });
  next();
}
function requireEditor(req, res, next) {
  if (!req.session.user || req.session.user.role === "consulta")
    return res.status(403).json({ error: "Perfil sem permissão de edição" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin")
    return res.status(403).json({ error: "Apenas administradores" });
  next();
}

// ── Criação automática das tabelas ───────────────────────────
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'consulta' CHECK (role IN ('admin', 'editor', 'consulta')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      user_name TEXT,
      acao TEXT,
      modulo TEXT,
      nome TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("Tabelas verificadas/criadas.");
}

// ── Seed de usuários iniciais ────────────────────────────────
async function seedUsersIfEmpty() {
  const { rows } = await pool.query("SELECT COUNT(*) AS n FROM users");
  if (parseInt(rows[0].n) > 0) return;
  const defaults = [
    { email: "admin@turismoitatinga.com.br",    name: "Administrador", role: "admin",    senha: "Itatinga@2026"   },
    { email: "editor@turismoitatinga.com.br",   name: "Editor",        role: "editor",   senha: "Inventario@2026" },
    { email: "consulta@turismoitatinga.com.br", name: "Consulta",      role: "consulta", senha: "Consulta@2026"   },
  ];
  for (const u of defaults) {
    const hash = await bcrypt.hash(u.senha, 12);
    await pool.query(
      "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [u.email, u.name, hash, u.role]
    );
  }
  console.log("Usuários iniciais criados.");
}

// ── AUTH ─────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: "E-mail e senha obrigatórios" });
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE lower(email)=lower($1) AND active=true", [email]
    );
    if (!rows.length) return res.status(401).json({ error: "Credenciais inválidas" });
    const ok = await bcrypt.compare(senha, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciais inválidas" });
    req.session.user = { id: rows[0].id, nome: rows[0].name, email: rows[0].email, role: rows[0].role };
    res.json({ user: req.session.user });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erro interno" }); }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// ── INVENTÁRIO ───────────────────────────────────────────────
app.get("/api/data", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT data FROM inventory WHERE id=1");
    res.json({ data: rows[0]?.data || {} });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erro ao carregar dados" }); }
});

app.post("/api/data", requireAuth, requireEditor, async (req, res) => {
  try {
    const { data } = req.body;
    await pool.query(`
      INSERT INTO inventory (id, data, updated_at) VALUES (1, $1::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET data = $1::jsonb, updated_at = now()
    `, [JSON.stringify(data)]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erro ao salvar dados" }); }
});

// Rota pública: só publicar_guia=Sim e não Inativo
app.get("/api/public", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT data FROM inventory WHERE id=1");
    const allData = rows[0]?.data || {};
    const pub = {};
    for (const [key, value] of Object.entries(allData)) {
      if (!Array.isArray(value)) { pub[key] = value; continue; }
      pub[key] = value.filter(r =>
        r.publicar_guia === "Sim" && (!r.status || r.status !== "Inativo")
      );
    }
    res.json({ data: pub });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erro" }); }
});

// ── USUÁRIOS ─────────────────────────────────────────────────
app.get("/api/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, role, active, created_at FROM users ORDER BY created_at"
    );
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: "Erro ao listar usuários" }); }
});

app.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, nome, role, senha } = req.body;
    if (!senha || senha.length < 6) return res.status(400).json({ error: "Senha muito curta (mín. 6 caracteres)" });
    const hash = await bcrypt.hash(senha, 12);
    const { rows } = await pool.query(
      "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id,email,name,role,active",
      [email, nome, hash, role]
    );
    res.json({ user: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "E-mail já cadastrado" });
    res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

app.put("/api/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nome, role, active, senha } = req.body;
    if (senha && senha.length > 0) {
      const hash = await bcrypt.hash(senha, 12);
      await pool.query(
        "UPDATE users SET name=$1, role=$2, active=$3, password_hash=$4 WHERE id=$5",
        [nome, role, active, hash, req.params.id]
      );
    } else {
      await pool.query(
        "UPDATE users SET name=$1, role=$2, active=$3 WHERE id=$4",
        [nome, role, active, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Erro ao atualizar usuário" }); }
});

app.delete("/api/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (String(req.session.user.id) === String(req.params.id))
      return res.status(400).json({ error: "Não é possível excluir o próprio usuário" });
    await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Erro ao excluir usuário" }); }
});

// ── AUDITORIA ────────────────────────────────────────────────
app.post("/api/audit", requireAuth, async (req, res) => {
  try {
    const { acao, modulo, nome } = req.body;
    await pool.query(
      "INSERT INTO audit_log (user_id, user_name, acao, modulo, nome) VALUES ($1,$2,$3,$4,$5)",
      [req.session.user.id, req.session.user.nome, acao, modulo, nome || "—"]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Erro ao registrar auditoria" }); }
});

app.get("/api/audit", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, user_name, acao, modulo, nome, created_at FROM audit_log ORDER BY created_at DESC LIMIT 500"
    );
    res.json({ logs: rows });
  } catch (e) { res.status(500).json({ error: "Erro ao carregar auditoria" }); }
});

// ── Health ───────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Fallback SPA ─────────────────────────────────────────────
app.get("*", (req, res) => {
  if (req.path.startsWith("/guia")) {
    return res.sendFile(path.resolve(__dirname, "..", "web", "guia", "index.html"));
  }
  res.sendFile(path.resolve(__dirname, "..", "web", "gestor", "index.html"));
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`API rodando na porta ${PORT}`);
  try {
    await initDatabase();
    await seedUsersIfEmpty();
  } catch (e) { console.error("Erro na inicialização:", e.message); }
});
