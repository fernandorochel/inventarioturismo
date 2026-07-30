# Deploy no Easypanel — inventario.turismoitatinga.com.br

Repositório: https://github.com/fernandorochel/inventarioturismo.git

## O que vai para o ar

| URL | O quê |
|-----|-------|
| `inventario.turismoitatinga.com.br/` | Redireciona para o gestor |
| `inventario.turismoitatinga.com.br/gestor/` | Sistema de gestão (login obrigatório) |
| `inventario.turismoitatinga.com.br/guia/` | Guia da Cidade (público) |
| `inventario.turismoitatinga.com.br/api/` | API REST (usada internamente) |

## Passo a passo

### 1. Adicionar a pasta `deploy/` ao repositório GitHub

Na sua máquina, dentro da pasta do projeto:
```bash
git add deploy/
git commit -m "feat: pasta deploy com API, schema e HTMLs adaptados"
git push
```

### 2. Criar arquivo `.env` no servidor (NÃO suba para o GitHub)

Conecte via SSH no seu servidor Easypanel e crie o arquivo:
```bash
# Gerar SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Criar o .env dentro da pasta deploy/:
DB_PASSWORD=SuaSenhaForteAqui
SESSION_SECRET=coleAStringGeradaAcima
```

### 3. Criar o App no Easypanel

1. Easypanel → **Create** → **App**
2. Source: **GitHub** → repositório `fernandorochel/inventarioturismo`
3. **Build Path / Contexto:** `deploy`
4. **Build:** `docker-compose.yml`
5. Em **Domains**, adicionar: `inventario.turismoitatinga.com.br`  
   Ativar **HTTPS** (Let's Encrypt automático)
6. Em **Environment**, adicionar as duas variáveis do `.env`:
   - `DB_PASSWORD`
   - `SESSION_SECRET`
7. **Deploy**

### 4. DNS

No painel do seu provedor de domínio, crie:

```
inventario.turismoitatinga.com.br  CNAME  seu-servidor.easypanel.host
```
(ou registro A se tiver o IP fixo do servidor)

### 5. Primeiro acesso

1. Abra `https://inventario.turismoitatinga.com.br`
2. Faça login com as credenciais iniciais:

| Perfil | Login | Senha |
|--------|--------|-------|
| Admin | `Rochel` | `Rochel` |

3. Em Administração → Usuários, cadastre os demais usuários conforme necessário.

### 6. Migrar dados do sistema atual (opcional)

Se já tiver dados no sistema local (localStorage), exporte pelo módulo  
**Relatórios e Exportação → Exportar JSON** e reimporte pelo módulo  
**Relatórios e Exportação → Importar JSON** após o deploy.

## Estrutura da pasta `deploy/`

```
deploy/
├── api/
│   ├── Dockerfile      ← build do Node.js
│   ├── package.json
│   └── server.js       ← API Express com auth + CRUD
├── db/
│   └── schema.sql      ← criado automaticamente no 1º boot
├── web/
│   ├── index.html      ← redireciona para /gestor/
│   ├── gestor/
│   │   └── index.html  ← sistema de gestão
│   └── guia/
│       └── index.html  ← guia público da cidade
├── docker-compose.yml  ← PostgreSQL + API + static files
├── .env.example        ← modelo (não suba o .env real!)
└── .gitignore
```
