---
name: orquestrar-projeto
description: |
  Orquestra um conjunto de tickets do Linear em ondas com portao de merge:
  cria uma worktree filha no Orca por ticket, sobe um agente Claude autonomo
  em cada uma, monitora ate o PR abrir, roda a review cruzada com o Codex,
  tria os achados, manda o worker aplicar os validos, e libera a proxima onda
  quando o gate de Revisao do AGENTS.md fecha e o PR e mergeado. Use quando o usuario disser "orquestre",
  "rode a onda", "toque esses tickets", ou colar IDs/URL de projeto do Linear
  com intencao de implementar tudo.
---

# Orquestrar tickets em ondas (Orca + Claude + Codex)

Voce e o **orquestrador**, nao o implementador. Nao escreva codigo de
producao. Seu trabalho: ler os tickets, montar o grafo, criar worktrees,
despachar agentes, monitorar, rodar a review cruzada, triar achados e
relatar. O merge e o portao da proxima onda, e so sai pelo gate de Revisao
do `AGENTS.md`.

Argumentos: IDs de tickets (`FIL-56 FIL-57`) ou nome/URL de projeto do
Linear. Se nao vier nada, pergunte.

## Politica fixa (nao re-pergunte)

- **Ondas com portao de merge** — ticket so comeca quando TODOS os blockers
  dele estao mergeados na `main`. Todo PR aponta pra `main`. Sem branch
  empilhada.
- **Claude implementa, Codex revisa.** O plano do Codex e o escasso: ele NAO
  implementa; entra uma vez por ticket, depois do PR aberto, como segunda
  opiniao de outra familia. Escale um ticket dificil mudando o modelo do
  Claude, nunca trocando de fornecedor.
- **Merge so com o gate verde.** Voce mergeia quando o gate de Revisao do
  `AGENTS.md` fecha no head atual (resumo do Codex sem achado aberto, CI
  verde, dependencias no `main`). Faltou um item: nao mergeie. Resultado de
  uma onda = PRs mergeados ou com o motivo do bloqueio + achados triados +
  relatorio.
- **Toda worktree filha nasce de `origin/main` fresca** — `git fetch origin
  main` antes de cortar qualquer onda.

## Fase 0 — Ler os tickets

1. Leia cada ticket por completo. Da worktree, a fonte e o CLI:
   `orca linear issue <ID> --full --json` (confira flags com
   `orca linear --help`; pra projeto inteiro, use a busca do
   `orca linear`).
2. Dependencia e SO o que esta em `blockedBy` — nunca inferida do titulo.
3. Ticket vago demais pra virar prompt autocontido: pare e pergunte ao
   humano a decisao especifica que falta. Nao invente escopo.

## Fase 1 — Grafo e tabela de ondas

- Onda do ticket = `max(onda de cada blocker) + 1`; sem blocker aberto =
  Onda 1. Ticket ja `Done` conta como blocker satisfeito.
- Imprima a tabela: `| Onda | Tickets | Desbloqueia |`. Marque fan-in
  (2+ blockers) explicitamente.

## Fase 2 — Despachar uma onda

Antes de qualquer criacao: `git fetch origin main`.

Para cada ticket da onda (crie TODAS as worktrees antes de acompanhar
qualquer uma — paralelo de verdade, nao fila):

1. **Escreva o prompt num arquivo** (scratchpad). Conteudo: instrucao de ler
   o ticket + o contrato fixo abaixo. Nunca cole texto longo direto no
   `terminal send` — a caixa de input embaralha; arquivo + ponteiro de uma
   linha e a forma confiavel (aprendido na pratica).

   Contrato fixo do worker (embuta no prompt):
   > 1. Leia o ticket com `orca linear issue --current --full --json` e
   >    implemente EXATAMENTE o que ele diz — escopo, fora-de-escopo, ACs.
   > 2. Leia `docs/WORKFLOW.md` antes de criar branch/PR. O Orca cria a
   >    branch como `<usuario>/<nome>`; renomeie pro padrao
   >    `<tipo>/<descricao>` do WORKFLOW.md §1 ANTES do primeiro push.
   > 3. Rode a suite (server e/ou client conforme o ticket) e so avance se
   >    passar de verdade.
   > 4. Abra o PR contra `main` com `gh pr create --base main`. NAO faca
   >    merge, NAO toque na `main`.
   > 5. Anexe o PR no ticket: `orca linear attach --current --url <url>
   >    --title "PR"` e mova o status pra review.
   > 6. Duvida que o ticket nao responde: NAO decida; imprima uma linha
   >    comecando com `PERGUNTA:` e pare.

2. **Crie a worktree ja com o agente** (o lancamento automatico funciona —
   exige "Wait for setup" DESLIGADO no Windows, ver playbook):

   ```bash
   orca worktree create --name <slug> --linear-issue <ID> \
     --agent claude --prompt "$(cat <arquivo-prompt>)" --json
   ```

   Se o agente nao subir (bug de plataforma), fallback em dois passos:
   `orca worktree create --name <slug> --linear-issue <ID> --json` e depois
   `orca terminal create --worktree name:<slug> --command "claude" --focus
   --json`, seguido de `terminal wait --for tui-idle` e `terminal send` com
   o ponteiro pro arquivo.

3. Registre worktree, terminal handle e ticket na sua tabela de estado.

## Fase 3 — Monitorar os workers

- Acompanhe com `orca worktree ps` e `orca terminal wait --terminal <h>
  --for tui-idle --timeout-ms 600000` (worker ocioso = terminou ou travou).
- Worker ocioso: leia o final da saida (`orca terminal read`) e verifique o
  PR de verdade: `gh pr view <n> --json baseRefName,state,files`. Confirme
  base `main` e arquivos dentro do escopo do ticket.
- Linha `PERGUNTA:` na saida: responda a partir do ticket; se o ticket nao
  responde, leve ao humano. Nunca chute.

## Fase 4 — Review cruzada (Codex), por ticket, assim que o PR abre

Nao espere a onda inteira: revise cada PR quando ele abrir.

```bash
orca terminal create --worktree name:<slug> --title review \
  --command "codex review --base main" --json
orca terminal wait --terminal <handle> --for exit --timeout-ms 900000
orca terminal read --terminal <handle> --limit 200
```

Regras aprendidas na pratica:
- `codex review --base main` NAO aceita prompt junto (erro de argumento).
  Instrucao padrao basta.
- **Exija saida visivel.** Sem relatorio impresso != review limpa. Erro 400
  `model requires a newer version of Codex` = CLI desatualizado:
  `npm install -g @openai/codex@latest` e rode de novo.
- Cota do Codex estourada: registre "review nao feita por cota", siga em
  frente e diga isso no relatorio. Trabalho nao se perde; so a segunda
  opiniao.

**Triagem** (comentario de review e insumo, nunca ordem):
- Correcao/regressao/teste faltando, confirmado no codigo: escreva a
  instrucao de fix num ARQUIVO na worktree do ticket e mande o worker
  aplicar (ponteiro de uma linha via `terminal send`). Commit + push na
  MESMA branch — sem PR novo.
- Achado que contradiz o ticket: nao decida; apresente ao humano o achado e
  o texto do ticket, com sua recomendacao.
- Invalido/estilo/fora de escopo: registre o motivo e nao mexa.

## Fase 5 — Portao de merge e proxima onda

O `codex review` local da Fase 4 e insumo de triagem. Ele nao gera o
`codex-review-state` do GitHub, entao nao fecha o gate.

1. Depois de cada push do worker, comente `@codex review` no PR (exceto PR
   de `cursor[bot]`: ai o Filippe pede o review).
2. Leia o estado do Codex no head atual:

   ```bash
   gh pr view <n> --json headRefOid -q .headRefOid
   gh api repos/<dono>/<repo>/issues/<n>/comments --paginate \
     -q '[.[]|select(.user.login|test("codex"))|.body|capture("codex-review-state:v1 (?<j>[{].*[}]) -->")|.j]|last'
   ```

   Precisa: `code_review.commit_sha` igual ao head, `status` `completed`,
   `has_unresolved_findings` falso. Achado aberto volta pra triagem da Fase 4.
3. Confira o CI: `gh pr checks <n>` todo verde (`ci`, `Site`, `Coletor`).
4. Confira dependencias mergeadas e migration nova aplicada em producao.
5. Gate inteiro verde: `gh pr merge <n> --merge`. Faltou um item: nao
   mergeie.

- A cada merge: `git fetch origin main`, recompute blockers, e despache
  (Fase 2) todo ticket que ficou livre. Repita ate acabar.
- Ao final: tabela com ticket, PR, estado da review, e pendencias que so o
  humano fecha (ex.: testar instalacao no celular, flag pra ligar).

## Pegadinhas (custaram horas reais)

- **Texto longo via `terminal send` embaralha.** Instrucao vai em arquivo;
  o send leva so "leia e execute <arquivo>". Confira a caixa antes do Enter.
- **`--base` + prompt no `codex review` = erro.** Use so `--base main`.
- **Review sem saida nao e review.** O 400 do modelo pode falhar em
  silencio; exija o relatorio impresso.
- **Worktree filha de main fresca.** Cortar de `origin/main` velha faz o
  worker nao ver o codigo do blocker e reimplementar.
- **Branch nasce `<usuario>/<nome>`** (gitUsername do Orca); o contrato
  manda renomear antes do push. Nunca renomeie DEPOIS do PR aberto via
  `git branch -m` + push — isso fecha o PR; pelo GitHub (Rename branch) o
  PR e reapontado.
- **`orca linear attach` quando o PR ja existe;** nao invente flags — na
  duvida, `orca linear --help`.
