# Segurança e LGPD — revisão de 2026-10

Revisão geral do sistema (site, API, Coletor, bot, CI, banco) contra OWASP Top 10, cheat
sheets da OWASP, boas práticas de Express/Supabase e a LGPD (Res. CD/ANPD 2/2022, agente
de pequeno porte). Feita por leitura de código e testes; nada foi testado contra produção.

## Resultado

Sem falha crítica: nenhuma SQL injection, nenhum segredo no repositório nem no histórico
do git, todas as rotas com dado pessoal exigem login e aplicam a visibilidade por amizade.

## O que foi corrigido

| Gravidade | Onde | Falha | Correção |
|---|---|---|---|
| Alta | `supabase/migrations` | 22 tabelas criadas da 0011 em diante sem RLS e com os grants padrão do Supabase para `anon`/`authenticated` — legíveis e graváveis pela REST API com a anon key | `0053_rls_e_grants_em_todas_as_tabelas.sql`: RLS em todas as tabelas, revoke de anon/authenticated e default privileges para tabelas futuras |
| Média | `site/server/src/routes/auth.js` | Login CSRF: a URL de retorno do OpenID podia ser concluída no navegador de outra pessoa | `state` aleatório em cookie httpOnly, conferido em tempo constante no retorno |
| Média | `coletor/src/coletor/main.py` | Logs do Actions (repositório público) mostravam SteamID e share code (o share code baixa a demo com os 10 jogadores) | Valores trocados por `_ref()` (hash curto) |
| Média | `site/server/src/routes/upload.js` | Qualquer conta Steam pedia URLs de upload sem limite (custo de R2) | Máximo de 5 uploads pendentes por jogador (429) |
| Média | LGPD | Sem aviso de privacidade nem forma de exercer direitos | Página `/privacidade`; em Minha conta: baixar meus dados, excluir conta (anonimização) e desligar métricas |
| Baixa | `coletor` (bz2, gzip FACEIT, fila pro, .rar) | Download/descompressão sem teto (bomba de descompressão), `file://` aceito, link simbólico dentro do .rar, tamanho declarado do .rar confiado | Tetos de bytes, só http(s), rejeita membro que não é arquivo comum, confere tamanho real |
| Baixa | `.github/workflows/coletor.yml` | `pip-audit` sem versão, instalado no mesmo ambiente dos segredos | Versão fixa em venv separado |
| Baixa | `site/server/src/routes/clipes.js` | `?periodo=constructor` derrubava a rota (500); lista sem limite | `Object.hasOwn` e `limit 200` |
| Baixa | `site/server/src/routes/competicoes.js` | Tradelink sem validação; admin conferido pelo claim do JWT (admin rebaixado via tradelinks por 7 dias) | Regex do link de troca da Steam + teto; admin conferido no banco |
| Baixa | `site/server/src/routes/matches.js` | Rota de clipe pago (Allstar) sem rate limit estrito; resposta de erro repassava texto do Allstar; log com SteamID | `limiteEstrito`, erro genérico, log sem SteamID |
| Baixa | `site/server/src/r2.js` | Download da demo repassava o ContentType gravado no R2 (na origem do site) | Sempre `application/octet-stream` + `attachment` |
| Baixa | `site/server/src/app.js` | `X-Powered-By: Express`; log de erro com objeto inteiro do pg (pode ter valores das linhas) | Header desligado; log só com código e mensagem |
| Baixa | `site/client/src/observabilidade/posthog.js` | URL das páginas mandava SteamID de terceiros (`/jogador/<id>`) e id de partida ao PostHog | IDs viram `:steamid` / `:id` nos campos de URL; opção de desligar métricas |
| Baixa | `site/client` (Partida, Competições, Admin) | Links vindos da API sem checar o esquema (`javascript:`) | `hrefSeguro()` só aceita http(s) |
| Baixa | `site/client/vercel.json` | Sem CSP nem Permissions-Policy | CSP em modo **Report-Only** (só reporta, não bloqueia) e Permissions-Policy |

## Pendências que dependem de você

1. **Aplicar a migration `0053` no Supabase de produção.** Até lá as 22 tabelas continuam
   expostas a quem tiver a anon key. Depois, rodar o Security Advisor do Supabase.
2. **Definir `VITE_CONTATO_PRIVACIDADE`** (e-mail de contato) no projeto `resenha` da Vercel.
3. **CSP:** abrir o site depois do deploy, olhar o console por violações de
   `Content-Security-Policy-Report-Only`; sem violações, trocar para `Content-Security-Policy`.
4. **Logs antigos do Actions** ainda têm SteamID e share code: apagar as execuções antigas
   do workflow do Coletor (ou reduzir a retenção de logs em Settings > Actions).

## Decisões de produto (não alteradas)

- **Amizade automática pela Steam** (`auth.js`): amigos da Steam com conta viram amizade
  aceita sem confirmação. Pela LGPD, o ideal é virar "pendente" (sugestão).
- **Competições** mostram leaderboard e clipes de todos os participantes, fora da rede de
  amizade. Documentar como exceção ou limitar a amigos.
- **`POST /api/amigos`** diz se um SteamID tem conta (404 x 201). Útil para a interface, mas
  permite enumerar quem usa o site.
- **Excluir conta** anonimiza (não apaga) as estatísticas das partidas, porque elas também
  são dos outros 9 jogadores.

## Recomendações maiores (não feitas nesta revisão)

- **Rate limit compartilhado:** o `express-rate-limit` guarda contagem na memória de cada
  instância da Vercel; para valer de verdade precisa de Redis/Upstash ou regra no WAF da Vercel.
- **Upload com tamanho assinado:** trocar o PUT pré-assinado por `createPresignedPost` com
  `content-length-range`, e regra de ciclo de vida no prefixo `uploads-pendentes/` do R2.
- **Parser de demo isolado:** rodar o `demoparser2` num subprocesso sem as variáveis de
  ambiente com segredos (uma demo maliciosa explorando o parser hoje alcançaria os segredos).
- **Dependências do Coletor com hash** (`pip-compile --generate-hashes` + `--require-hashes`).
- **bot:** `adm-zip` (via `steam-user`) tem 3 alertas altos no `npm audit`; testar
  `overrides: { "adm-zip": "^0.6.0" }` com login real no Game Coordinator.
- **Imagens Docker do CI** (gitleaks, osv-scanner) por digest `@sha256`.
- **Iframes do Allstar** com `sandbox`, testando se o player continua funcionando.
- **Retenção:** prazo para `replay.json`, cache `steam_avatares` e tradelink depois da entrega do prêmio.
- **Confirmar `NODE_ENV=production`** na Vercel (o cookie só sai com `Secure` assim).

## Registro simplificado de tratamento (LGPD)

| Dado | Finalidade | Base legal | Retenção |
|---|---|---|---|
| SteamID, nick, avatar | Conta e exibição ao grupo | Legítimo interesse | Até excluir a conta |
| Estatísticas de partidas (inclusive adversários) | Análise das partidas do grupo | Legítimo interesse | Enquanto o site existir; anonimizadas ao excluir conta |
| Código de histórico / share code | Descobrir partidas automaticamente | Execução do pedido do titular | Até excluir a conta |
| Vínculo FACEIT | Importar partidas da FACEIT | Pedido do titular | Até excluir a conta |
| Tradelink | Entregar prêmio de competição | Pedido do titular | Recomendado apagar após a entrega |
| Demos (.dem) | Processar estatísticas | Legítimo interesse | ~14 dias (bruto); uploads órfãos 30 dias |
| Métricas (PostHog) e erros (Sentry) | Manter o site funcionando | Legítimo interesse, com opção de desligar | Padrão de cada serviço |
