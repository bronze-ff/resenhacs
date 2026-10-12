# Fluxo de trabalho: branches, worktrees, PRs e backlog

Guia prático pra manter o repositório organizado — nasceu de uma limpeza real em
2026-07-23 onde o projeto acumulou branches sem nome claro, worktrees esquecidas,
14 PRs do Dependabot paradas, e uma PR de bundle de ferramentas que ninguém lembrava
de ter pedido. As regras abaixo existem pra isso não se repetir.

Pesquisa de referência (git branching, worktrees, PRs, GitHub Issues) nas fontes ao final.

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

## 5. Manter o `main` local sincronizado

- Sempre sincronizar o `main` local com o `origin/main` com frequência —
  `git fetch origin && git pull --rebase origin main` — em vez de deixar acumular
  divergência até precisar mexer nele. Descobrir a divergência só na hora de agir
  (como aconteceu em 2026-07-23: main local 1 commit à frente por um spec, origin 4
  commits à frente por merges do Dependabot) transforma um `pull` trivial num rebase
  reativo no meio da tarefa.
- Só é aceitável o `main` local ficar à frente do `origin/main` por commits **pequenos
  e de baixo risco** (doc, spec, ajuste de config) que ainda não foram enviados. Isso
  segue o mesmo padrão que o próprio repositório já usa pra commits de documentação
  direto no `main` (ex.: `97a8ce5 docs: adiciona guia de fluxo de trabalho`).
- Trabalho de implementação de verdade (código, migration, feature) **não** deve
  acumular no `main` local, nem sem push — vai pra branch/worktree dedicada (seções 1
  e 2). Um `main` local carregando commits de feature é fácil de esquecer, mistura
  contexto de tarefas diferentes, e tende a virar o mesmo tipo de bagunça que motivou
  este guia.

## 6. Antes de começar uma branch longa

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

## 7. Backlog / issues

Issues ficam no **GitHub Issues deste repositório**. Não abrir issue no Linear e
não usar `FIL-xxx` em branch, PR ou documento novo. Comentários antigos no código
que citam `FIL-xxx` são o id histórico do Linear; sem uma tabela de mapeamento
eles não viram `#n`.

- Labels por tipo (`tipo:bug`, `tipo:feature`, `tipo:melhoria`) e prioridade
  (`prioridade:alta`, `prioridade:media`, `prioridade:baixa`).
- Entrega que atravessa várias sessões vira um conjunto de issues, não uma nota
  só na conversa.
- Toda PR referencia a issue (`Fixes #n` ou `Closes #n`).
- Decisão importante que não é issue vira ADR em `docs/decisoes/`.

## 8. Regras específicas pra sessões de IA (Claude Code)

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
