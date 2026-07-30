# Revisão inicial — Sistema Inventário Turismo

## Estrutura encontrada

- `deploy/web/gestor/index.html`: sistema de gestão, com login e áreas administrativas.
- `deploy/web/guia/index.html`: guia público, alimentado por `/api/public`.
- `deploy/api/server.js`: API Node.js/Express com autenticação, usuários, inventário em JSONB e auditoria.
- `deploy/db/schema.sql`: schema PostgreSQL.
- `deploy/docker-compose.yml`: PostgreSQL + API + arquivos estáticos.

## Ajustes já realizados

- Corrigidos os caminhos do `deploy/api/Dockerfile` para funcionar com o contexto `deploy/` usado no `docker-compose.yml`.
- Removido do HTML do gestor um bloco antigo de usuários/senhas padrão que não era mais usado pelo login atual.
- Criados `deploy/.env.example` e `deploy/.gitignore`, citados na documentação mas ausentes no ZIP.
- Ajustada a API para exigir `SESSION_SECRET` em produção e marcar o cookie de sessão como seguro quando `NODE_ENV=production`.
- Alterado o acesso inicial para `Rochel / Rochel`, deixando apenas esse usuário administrador como seed inicial.

## Pontos de atenção

- As senhas iniciais continuam no backend para criação automática do primeiro acesso. Após subir o sistema, trocar imediatamente pelo módulo Administração > Usuários.
- O ambiente local atual não tem Docker no caminho padrão, então a validação de container ainda precisa ser feita em uma máquina com Docker ou direto no Easypanel.
- A API foi validada por checagem de sintaxe com Node.js do runtime local do Codex.
- O sistema está em arquivos HTML grandes e monolíticos. Para evoluir bastante, vale separar em arquivos menores ou migrar para uma estrutura frontend com componentes.

## Como retomar

1. Conferir `deploy/.env.example` e criar um `.env` real somente no servidor.
2. Rodar o deploy com o contexto `deploy/`.
3. Acessar `/gestor/`, entrar com o usuário inicial e trocar as senhas.
4. Revisar quais cadastros devem ter `publicar_guia = "Sim"` para aparecerem no `/guia/`.
