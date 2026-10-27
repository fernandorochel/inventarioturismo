-- ============================================================
-- Gestão do Turismo de Itatinga — Schema PostgreSQL
-- ============================================================

-- Inventário completo (um único registro JSONB espelhando o DATA do sistema)
CREATE TABLE IF NOT EXISTS inventory (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Planejamento interno de apresentações, separado do inventário público.
CREATE TABLE IF NOT EXISTS local_performances (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  data        JSONB NOT NULL DEFAULT '{"queues":{},"events":[]}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT local_performances_single_row CHECK (id = 1)
);
INSERT INTO local_performances (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Usuários
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'consulta'
                CHECK (role IN ('admin', 'editor', 'consulta')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

-- Sessões (gerenciado pelo connect-pg-simple)
CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   JSONB NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);

-- Log de auditoria
CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT,
  user_name  TEXT,
  acao       TEXT,
  modulo     TEXT,
  nome       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
