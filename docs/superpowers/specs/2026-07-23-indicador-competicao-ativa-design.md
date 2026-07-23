# Indicador de competição ativa (sidebar + barra mobile) — Design

**Data:** 2026-07-23

**Origem:** pedido do Filippe durante a spec de "imagem/link de mercado no prêmio" —
quando existe uma competição ativa, ele quer um indicador visual chamando atenção do
usuário, tanto na sidebar do desktop quanto na navegação mobile.

## Objetivo

Fazer o usuário notar rapidamente que existe uma competição rolando, sem precisar entrar
na aba de Competições pra descobrir. Dois lugares: sidebar desktop (item "Competições" já
existe, ganha um indicador) e barra inferior mobile (que hoje nem lista "Competições" —
ela some dentro do menu "Mais").

## Escopo

**Dentro:** endpoint leve de status ("existe competição ativa agora?"), ponto pulsante na
sidebar desktop, redefinição das 4 abas fixas da barra inferior mobile, substituição
dinâmica de uma delas por "Competições" com o mesmo indicador quando há competição ativa.

**Fora (v1):** notificação "lida/não lida" por jogador (indicador é sempre visível
enquanto a competição estiver ativa, não desaparece depois que o usuário visita a aba —
decisão já tomada, ver seção Comportamento). Sistema de métricas de uso pro admin (quais
abas cada jogador mais acessa) é um projeto futuro separado, fora deste spec — a escolha
das 4 abas fixas abaixo é julgamento de produto a partir do `PRODUCT.md`, não dado real.

## Comportamento

- O indicador aparece sempre que existe competição ativa (`data_inicio <= agora <=
  data_fim`), pro que já é calculado hoje em `GET /api/competicoes` (`ativa`).
- Fica visível o tempo todo enquanto durar, mesmo depois do usuário já ter entrado na aba
  — é lembrete contínuo pra participar, não notificação de novidade.
- Some sozinho quando a competição termina (próximo poll já não encontra `ativa`).

## Backend — endpoint leve de status

`GET /api/competicoes/status`, novo, em `site/server/src/routes/competicoes.js`:

```sql
select exists(
  select 1 from competicoes where data_inicio <= now() and data_fim >= now()
) as tem_ativa
```

Retorna `{ temAtiva: boolean }`. Existe separado de `GET /` porque esse último já calcula
leaderboard completo de todas as competições (pesado) e `Shell.jsx` fica montado em toda
página autenticada — chamar o endpoint pesado a cada 60s de cada página seria desperdício
de carga no banco. `requireAuth` (mesmo padrão dos outros endpoints do router), sem
`requireSuperAdmin` (qualquer jogador autenticado pode ver).

## Frontend — sidebar desktop (`Shell.jsx`)

- `Shell.jsx` passa a chamar `GET /api/competicoes/status` ao montar e a cada 60s
  (`setInterval`, mesmo espírito do polling de 30s já usado em `Feed.jsx` pro aviso de
  sincronização — intervalo maior aqui porque início/fim de competição não muda a cada
  segundo).
- Quando `temAtiva === true`, o item "Competições" da sidebar (`NAV_ICONES.competicoes`,
  dentro do `<span className="shrink-0">` em `Shell.jsx:254`) ganha um ponto pulsante
  sobreposto: `absolute -top-0.5 -right-0.5`, ~6-8px, `bg-destaque` +
  `animate-pulso-sinal` (mesma classe/token já usada em `Feed.jsx:112`), com um halo sutil
  via `box-shadow` na cor de destaque pra não parecer só uma bolinha crua — precisa de
  `position: relative` no wrapper do ícone pra o `absolute` posicionar corretamente.
- `prefers-reduced-motion` já é zerado globalmente em `index.css` — nenhum tratamento
  adicional necessário no componente.

## Frontend — barra inferior mobile (`Shell.jsx`, `BarraInferior`/`NAV_INFERIOR_BASE`)

**Base fixa redefinida** (`NAV_INFERIOR_BASE`, `Shell.jsx:165-170`): **Partidas, Ranking,
Clipes, Comparar** — troca de Granadas/Táticas (consulta situacional, ex.: lineup de smoke
antes de um round específico) por Clipes/Comparar (hábito mais recorrente pelo
`PRODUCT.md`: revisão da partida logo depois de jogar, e Head to Head citado
explicitamente como caso de uso recorrente pra resolver discussão do grupo). Granadas e
Táticas continuam acessíveis pelo menu "Mais" — não são removidas do app, só saem da
barra fixa.

**Substituição dinâmica:** quando `temAtiva === true` (mesmo polling do item acima, um
único fetch/estado em `Shell.jsx` compartilhado entre sidebar e barra mobile — não duas
chamadas), a posição de **Comparar** na barra é ocupada por **Competições**, com o mesmo
ponto pulsante sobreposto ao ícone. Partidas/Ranking/Clipes continuam fixos — não é
possível ficar sem Comparar OU sem Competições ao mesmo tempo; quando a competição
termina, a barra volta a mostrar Comparar.

`itens = temAtiva ? substituirComparar(NAV_INFERIOR_BASE) : NAV_INFERIOR_BASE` — troca só
o objeto `{ to: '/comparar', ... }` por `{ to: '/competicoes', label: 'Competições', icone:
'competicoes' }` dentro do array de 4, mantendo a mesma grid de 5 colunas (4 + "Mais") já
existente em `BarraInferior` (`Shell.jsx:379-390`). Nenhuma mudança estrutural na grade.

## Erros e casos extremos

- **Fetch de `/status` falha** (rede, servidor fora): trata como `temAtiva = false` —
  degrada pro estado normal (sem indicador, sem substituição), nunca quebra a navegação
  nem mostra estado inconsistente.
- **Duas competições ativas ao mesmo tempo** (não deveria acontecer pela regra de negócio
  atual, mas o `exists()` não impede): indicador continua funcionando normalmente — é só
  "existe pelo menos uma", não importa quantas.
- **Usuário no meio de preencher o tradelink de vencedor** (fluxo já existente em
  `Competicoes.jsx`) quando a competição termina e o indicador some: sem impacto — o
  indicador é só de descoberta, o fluxo de vencedor já é uma tela separada que o jogador
  acessa direto.

## Testes

- **Servidor (`vitest`):** `GET /api/competicoes/status` retorna `{ temAtiva: true }` com
  uma competição no período atual, `{ temAtiva: false }` sem nenhuma, `401` sem
  autenticação.
- **Client (`vitest` + testing-library, novo teste ou extensão de um existente de
  `Shell.jsx` se houver):**
  - Sidebar mostra o ponto pulsante no item Competições quando `temAtiva: true`, não
    mostra quando `false`.
  - Barra inferior mobile mostra Partidas/Ranking/Clipes/Comparar por padrão; mostra
    Partidas/Ranking/Clipes/**Competições** (com o ponto) quando `temAtiva: true`.
  - Fetch de `/status` falhando não quebra a renderização da barra (cai pro estado sem
    indicador).
