# Webapp de Comandas com QR Code

MVP full-stack para:

- cadastro e login do administrador
- criação de comandas com número sequencial
- geração de QR Code único para a página pública
- atualização em tempo real do status da comanda
- alerta sonoro e vibração no cliente quando ficar pronto
- histórico de comandas entregues

## Rodando localmente

Este projeto agora usa Supabase no backend via `SUPABASE_URL` + chave secreta.

1. Copie `.env.example` para `.env` e ajuste, se quiser.
2. Instale as dependências:
   ```bash
   npm install
   ```
3. No painel do Supabase, rode o SQL de [supabase/schema.sql](/Users/arthur/Documents/WebApp-Comandas/supabase/schema.sql).
4. Defina `SUPABASE_URL` e `SUPABASE_SECRET_KEY`.
5. Inicie o servidor:
   ```bash
   npm run start
   ```
6. Abra `http://localhost:3000`.

## Deploy na Vercel

O projeto foi ajustado para usar Supabase como camada de dados em qualquer ambiente.

### Variaveis recomendadas na Vercel

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `JWT_SECRET`
- `PUBLIC_BASE_URL`
- `COOKIE_SECURE=true`
- `REALTIME_TRANSPORT=polling`
- `MAIL_FROM`
- `SMTP_URL` ou conjunto `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`

### Observacoes importantes

- O schema das tabelas esta em [supabase/schema.sql](/Users/arthur/Documents/WebApp-Comandas/supabase/schema.sql).
- Segundo a documentacao oficial do Supabase, operacoes server-side devem usar uma `secret key` no backend; mantive o app nesse modelo.
- O app continua com atualizacao rapida para o cliente em producao usando polling a cada 2 segundos.
- Localmente, o fluxo com `Socket.IO` continua disponivel.

### Passos de deploy

1. Crie o projeto no Supabase.
2. Rode o SQL do schema.
3. Copie a `Project URL`.
4. Copie uma `Secret key` do projeto.
5. Importe o repositorio na Vercel.
6. Configure as variaveis de ambiente.
7. Faça o primeiro deploy.
8. Ajuste `PUBLIC_BASE_URL` para a URL final do projeto.

## Banco de teste

Para preencher seu banco do Supabase com dados de demonstração:

```bash
npm run seed:demo
```

Se preferir popular direto pelo painel SQL do Supabase, use [supabase/seed.sql](/Users/arthur/Documents/WebApp-Comandas/supabase/seed.sql).

Credenciais de teste:

- e-mail: `demo@comandas.local`
- senha: `Demo1234!`

Isso limpa os dados atuais do projeto Supabase configurado no ambiente e recria um conjunto minimo de comandas para testar o MVP.

## Observações

- A recuperação de senha tenta enviar e-mail quando `SMTP_*` ou `SMTP_URL` estiverem configurados.
- Sem SMTP, o sistema mostra o link de redefinição no ambiente de desenvolvimento.
- O app já inclui `manifest.json` e `sw.js` para facilitar evolução para PWA.

## Stack

- Express
- EJS
- Supabase Postgres
- Socket.IO
- bcryptjs
- JWT em cookie httpOnly
