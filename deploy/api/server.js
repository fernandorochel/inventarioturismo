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
const crypto     = require("crypto");

const app  = express();
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && !sessionSecret) {
  throw new Error("SESSION_SECRET é obrigatório em produção.");
}

app.set("trust proxy", 1);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// ── Middlewares ──────────────────────────────────────────────
app.use(express.json({ limit: "50mb" }));

app.use(session({
  store: new PgSession({ pool, tableName: "sessions", createTableIfMissing: true }),
  secret: sessionSecret || "fallback-dev-secret-mude-em-desenvolvimento",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: isProduction, maxAge: 8 * 60 * 60 * 1000 }
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

// ── Google Drive uploads ────────────────────────────────────
let driveTokenCache = { token: null, exp: 0 };

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) throw new Error("Arquivo inválido");
  return { mimeType: m[1], buffer: Buffer.from(m[2], "base64") };
}

function cleanFileName(name, mimeType) {
  const fallbackExt = mimeType === "application/pdf" ? ".pdf" : ".jpg";
  const safe = String(name || ("upload-" + Date.now() + fallbackExt))
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim();
  return safe || ("upload-" + Date.now() + fallbackExt);
}

async function getDriveAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (driveTokenCache.token && driveTokenCache.exp - 60 > now) return driveTokenCache.token;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    const err = new Error("Google Drive não configurado no servidor");
    err.status = 503;
    throw err;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    const err = new Error(tokenJson.error_description || tokenJson.error || "Falha ao autenticar no Google Drive");
    err.status = 502;
    throw err;
  }
  driveTokenCache = { token: tokenJson.access_token, exp: now + Number(tokenJson.expires_in || 3600) };
  return driveTokenCache.token;
}

async function uploadToDrive({ fileName, mimeType, buffer }) {
  const folderId = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID;
  if (!folderId) {
    const err = new Error("Pasta do Google Drive não configurada");
    err.status = 503;
    throw err;
  }

  const accessToken = await getDriveAccessToken();
  const boundary = "gti-" + crypto.randomBytes(12).toString("hex");
  const metadata = {
    name: fileName,
    parents: [folderId]
  };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length)
    },
    body
  });
  const file = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    const err = new Error(file.error?.message || "Falha ao enviar arquivo ao Google Drive");
    err.status = 502;
    throw err;
  }

  if (process.env.GOOGLE_DRIVE_UPLOAD_PUBLIC === "true") {
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role: "reader", type: "anyone" })
    }).catch(() => null);
  }

  return {
    id: file.id,
    name: file.name,
    viewUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    directUrl: process.env.GOOGLE_DRIVE_UPLOAD_PUBLIC === "true"
      ? `https://drive.google.com/uc?export=view&id=${file.id}`
      : (file.webContentLink || file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`)
  };
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
    { email: "Rochel", name: "Rochel", role: "admin", senha: "Rochel" },
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
    if (!email || !senha) return res.status(400).json({ error: "Login e senha obrigatórios" });
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

app.post("/api/uploads", requireAuth, requireEditor, async (req, res) => {
  try {
    const { fileName, dataUrl } = req.body;
    const parsed = parseDataUrl(dataUrl);
    const allowed = /^image\/(png|jpe?g|webp|gif)$/i.test(parsed.mimeType) || parsed.mimeType === "application/pdf";
    if (!allowed) return res.status(400).json({ error: "Envie uma imagem ou PDF" });
    if (parsed.buffer.length > 25 * 1024 * 1024) {
      return res.status(400).json({ error: "Arquivo muito grande. Limite: 25 MB" });
    }

    const file = await uploadToDrive({
      fileName: cleanFileName(fileName, parsed.mimeType),
      mimeType: parsed.mimeType,
      buffer: parsed.buffer
    });
    res.json({ file: { ...file, mimeType: parsed.mimeType } });
  } catch (e) {
    console.error("Erro no upload:", e.message);
    res.status(e.status || 500).json({ error: e.message || "Erro ao enviar arquivo" });
  }
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
    if (e.code === "23505") return res.status(400).json({ error: "Login já cadastrado" });
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
