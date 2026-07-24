# Competição "Em breve" + regras explícitas no card — Design

**Data:** 2026-07-24

**Origem:** Filippe criou a primeira competição real (Electrum Week, 25/07-31/07) e a aba
pública de Competições mostrou "Nenhuma competição no momento" — o backend já devolve
`agendadas` (fix de review antigo, consumido só pelo Admin), mas `Competicoes.jsx` só
renderiza `ativa` e `encerradas`. Pedido: mostrar a competição agendada como "em breve",
com regras claras (inclusive a de que só valem clipes de partidas jogadas dentro do
período), sem permitir envio de clipe antes de começar.

## Objetivo

Jogador vê a competição futura (nome, descrição, prêmio com foto/link, regras completas)
antes de ela começar, entende as regras, e o envio de clipe só libera quando o período
inicia.

## Escopo

**Dentro:** renderização de `agendadas` na aba pública com badge "EM BREVE" e sem botão
de envio; bloco de regras claro no card (todas as fases); guard server-side de "ainda não
começou" no envio de submissão.

**Fora:** countdown ao vivo, notificação de início (o indicador da sidebar já acende
sozinho quando ela ativa), mudanças no Admin.

## Frontend — `Competicoes.jsx`

- `carregar()`/fallbacks passam a incluir `agendadas: []`; render insere
  `{dados.agendadas.map(...)}` entre a ativa e as encerradas; o estado vazio
  ("Nenhuma competição no momento.") passa a considerar também `agendadas.length === 0`.
- `CardCompeticao` ganha `const naoComecou = new Date() < new Date(comp.dataInicio)`:
  - `naoComecou`: badge neutro **"EM BREVE"** ao lado do nome + linha
    "Começa em {dataHora(comp.dataInicio)}" (helper `dataHora` de `lib/format.js`).
  - Botão "Enviar clipe" só quando `!encerrada && !naoComecou` (hoje é só `!encerrada`).
  - Leaderboard/clipes recentes continuam renderizando (vazios numa agendada — sem custo).
- **Bloco de regras** substitui a linha telegráfica de limites (linhas 76-78), visível em
  qualquer fase:

```
REGRAS
· Período: {dataHora(dataInicio)} até {dataHora(dataFim)}
· Só valem clipes de partidas jogadas dentro do período — partidas de antes não contam.
· Até {limiteDiario} clipes por dia, {limiteTotal} no total.
· Mínimo de {minimoParaRankear} clipes enviados pra entrar no ranking.
· Pontuação: kills (curva não-linear) + headshots + clutch + variedade de armas.
```

(Lista `font-mono text-xs`, título no padrão dos outros sub-títulos do card; a regra do
período em destaque — ex. `text-texto` em vez de `text-texto-fraco`.)

## Backend — `competicoes.js`

`POST /:id/submissoes` (linha ~268): depois da checagem de encerrada, adicionar:

```javascript
if (new Date() < new Date(comp.data_inicio)) return res.status(400).json({ erro: 'essa competição ainda não começou' })
```

(`data_inicio` já vem no select.) Defesa em profundidade: na prática a elegibilidade por
`played_at` já barraria, mas o guard torna a regra explícita e a mensagem clara.

## Testes

- **Servidor:** `POST /:id/submissoes` numa competição com `data_inicio` no futuro → 400
  com mensagem de "não começou".
- **Client (`Competicoes.test.jsx`):** competição em `agendadas` renderiza com "EM BREVE"
  e sem botão "Enviar clipe"; regra do período aparece no card; competição ativa continua
  com o botão.
