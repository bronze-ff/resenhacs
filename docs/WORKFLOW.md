# Fluxo de trabalho: branches, worktrees, PRs e backlog

Guia prático pra manter o repositório organizado — nasceu de uma limpeza real em
2026-07-23 onde o projeto acumulou branches sem nome claro, worktrees esquecidas,
14 PRs do Dependabot paradas, e uma PR de bundle de ferramentas que ninguém lembrava
de ter pedido. As regras abaixo existem pra isso não se repetir.

Pesquisa de referência (git branching, worktrees, PRs, Linear) nas fontes ao final.

## 1. Nomeação de branches

Formato: `<tipo>/<descrição-curta-com-hífen>`

Tipos: `feat`, `fix`, `hotfix`, `chore`, `docs`, `refactor`.

- **Bom**: `feat/competicoes-clipes`, `fix/sessoes-map-crash`, `hotfix/matches-500-join`
- **Ruim**: `worktree-amizades-substitui-grupos`, `merge-competicoes-main`,
  `claude/priceless-burnell-d2a470` — descrevem o *mecanismo* (é uma worktree, é um
  merge) em vez do *conteúdo* (o que a branch faz). Impossível saber o que tem
  dentro sem abrir e investigar — foi exatamente o problema da limpeza de julho.

Branches geradas automaticamente por integrações (Dependabot, bots de nome
aleatório tipo `claude/nome-aleatorio-x`) não seguem esse padrão por natureza —
tudo bem, mas elas precisam ser triadas rápido (ver seção 4), não deixadas
acumulando.

## 2. Worktrees

- Uma worktree = uma tarefa ativa = uma branch. Nunca reaproveite uma worktree pra
  uma tarefa diferente da que ela foi criada — isso já causou uma sessão de IA
  editar por engano a branch errada no meio de uma limpeza de branches.
- Local: `.claude/worktrees/<nome-curto-da-branch>` (sem o prefixo do tipo, ex.:
  branch `feat/competicoes-clipes` → worktree `.claude/worktrees/competicoes-clipes`).
- Ciclo de vida: criar quando a tarefa começa → remover **imediatamente** depois do
  merge (`git worktree remove` + `git branch -d`), não "depois eu limpo".
- Antes de apagar uma worktree, sempre `git status --short` nela — nunca assuma que
  está limpa.

## 3. Pull Requests

- Título em Conventional Commits: `tipo: descrição` (`feat:`, `fix:`, `chore:`, etc.)
  — mesmo padrão da branch, sem o prefixo de path.
- PRs pequenas e focadas sempre que possível. Uma PR gigante (dezenas de arquivos)
  só é aceitável quando é literalmente o trabalho de reconciliar duas branches que
  já divergiram demais — trate isso como exceção cara, não como o normal.
- Descrição da PR sempre cobre: o que mudou, por quê, como foi testado, e **qualquer
  passo manual necessário antes/depois do merge** (ex.: "aplicar a migração X em
  produção antes de mergear" — esquecer de deixar isso explícito já causou um
  outage real neste projeto).
- Squash ou merge commit, tanto faz, desde que a mensagem final explique o *porquê*
  da mudança, não só o *o quê*.

## 4. Higiene e limpeza

- Auto-delete de branch ao mergear PR já fica ligado no GitHub (Settings → General →
  "Automatically delete head branches") — não desligar.
- Rodar uma auditoria (pelo menos semanal, ou sob demanda) com:
  ```bash
  git fetch origin --prune
  for b in $(git branch -r | grep -v HEAD); do
    git merge-base --is-ancestor "$b" origin/main && echo "MESCLADA: $b" || echo "PENDENTE: $b"
  done
  ```
  Toda branch "PENDENTE" precisa de uma decisão: virar PR e mergear, ou fechar
  explicitamente. Nunca deixar em limbo.
- PRs do Dependabot: revisar pelo menos semanalmente, não deixar acumular. Patches
  e minors de dependência de teste/build (vitest, jsdom, plugin-react, etc.) podem
  ser mesclados direto. Majors em dependência de produção (ex.: Express 4→5) e
  qualquer bump em pipeline crítico (parser de demo, driver de banco) merecem uma
  rodada de teste antes de mergear, não merge automático.

## 5. Antes de começar uma branch longa

- Sempre checar a divergência com a `main` **antes** de começar a trabalhar, não no
  meio:
  ```bash
  git merge-base HEAD main
  git log --oneline $(git merge-base HEAD main)..origin/main | wc -l
  ```
  Se o número for grande, decida entre sincronizar primeiro (merge/rebase da main
  pra dentro) ou aceitar conscientemente que vai reconciliar depois — mas *decida*,
  não descubra isso 30 tarefas depois.
- Branches que vão durar mais que alguns dias devem sincronizar com a `main`
  periodicamente (merge ou rebase), não só no final.

## 6. Backlog / issues

Hoje o projeto não usa nenhum rastreador — decisões e pendências vivem só na
conversa com a IA e nos arquivos de memória dela. Isso funciona pra pendências de
curto prazo, mas perde tudo que não vira ação imediata (ex.: "aplicar retry
automático em falhas transitórias" só não se perdeu porque virou uma tarefa em
background explícita).

Se for adotar o Linear (ou qualquer rastreador leve), o mínimo que compensa pra um
grupo pequeno:
- **Um time só**, sem sub-times — overhead de estrutura não compensa pra ~10 pessoas.
- **Labels por tipo** (bug, feature, chore) em vez de workflow complexo de status.
- **Projects** pra entregas maiores que atravessam várias sessões (ex.: "Competições
  de Clipes" seria um Project, não uma issue solta) — dá pra ver progresso sem
  precisar reconstruir o histórico de conversa.
- **Cycles** são opcionais — só valem a pena se o ritmo de trabalho for regular o
  suficiente pra um "sprint" fazer sentido; pra um projeto de fim de semana, pule.
- Toda PR referencia a issue relacionada (`Closes RES-42` na descrição) — sem isso,
  o rastreador vira só uma lista solta sem ligação com o código.

Sem um rastreador, o mínimo viável é: toda decisão importante e toda pendência
adiada vira uma nota explícita (arquivo de memória, comentário no código, ou
`spawn_task`), nunca só "vou lembrar disso".

## 7. Regras específicas pra sessões de IA (Claude Code)

Baseado em bugs reais desta sessão:

- **Sempre confirme o caminho absoluto antes de escrever um arquivo.** Rode
  `git rev-parse --show-toplevel` (ou equivalente) e compare com o caminho que você
  está prestes a usar — um caminho absoluto digitado de memória já mandou spec e
  plano pro repositório errado (o principal em vez da worktree) duas vezes na mesma
  sessão.
- **Ao resolver conflito de merge, desconfie do que está FORA dos marcadores
  `<<<<<<<`/`>>>>>>>` também.** O merge automático do git combina silenciosamente
  linhas próximas ao conflito sem marcar nada — já causou import duplicado (quebra
  de build) e um `JOIN` inteiro sumindo de uma query (500 em produção), nenhum dos
  dois dentro de uma região marcada como conflito.
- **Depois de resolver um merge grande, rode `git status --short` antes do commit
  final.** Uma correção real já ficou de fora de um commit porque o `git add -A`
  foi feito ANTES da correção, não depois — o texto do commit descrevia o fix
  correto, mas o fix não estava lá.
- **Nunca reaproveite uma worktree que já está em uso por outra sessão/tarefa em
  background.** Confira `git worktree list` e o que cada uma tem checked out antes
  de criar uma nova ou mexer numa existente.

## Fontes

- [Agile Git Branching Strategies in 2026](https://www.javacodegeeks.com/2025/11/agile-git-branching-strategies-in-2026.html)
- [Git Workflow Best Practices: The Developer's Guide for 2026](https://dev.to/_d7eb1c1703182e3ce1782/git-workflow-best-practices-the-developers-guide-for-2026-4gl0)
- [Git Branching Strategies: The Complete Guide for 2026](https://devtoolbox.dedyn.io/blog/git-branching-strategies-guide)
- [Git Worktree Best Practices - Directory Layout & Tips](https://www.gitworktree.org/guides/best-practices)
- [Git Worktree Workflow - Parallel Development Guide](https://www.gitworktree.org/guides/workflow)
- [Git Worktree Best Practices and Tools (gist)](https://gist.github.com/ChristopherA/4643b2f5e024578606b9cd5d2e6815cc)
- [Best practices for writing good pull request titles](https://graphite.com/guides/best-pr-title-guidelines)
- [Linear Task Management: Organize, Prioritize, and Deliver](https://everhour.com/blog/linear-task-management/)
- [Linear Project Management: Simplifying Project Planning for Small Teams](https://everhour.com/blog/linear-project-management/)
