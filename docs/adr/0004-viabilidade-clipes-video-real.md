# ADR-0004: Viabilidade de clipes em vídeo real (estilo Allstar.gg)

**Data:** 2026-07-19 (atualizado no mesmo dia com pesquisa sobre APIs de terceiros)
**Status:** Estudo de viabilidade — decisão pendente (aguardando o grupo). Recomendação mudou de "não fazer" para "integrar com API de terceiro (Allstar/Rankacy) em vez de construir renderização própria" após achar que o Allstar tem um programa de desenvolvedor oficial usado por concorrentes diretos.

## Contexto

O Resenha hoje trata "clipe" como um **link externo** (Allstar/Medal/YouTube) anexado manualmente por um jogador — decisão registrada em `CONTEXT.md`, `docs/BRIEF.md` e `docs/ROADMAP.md` ("a plataforma não renderiza vídeo... deep-link no Replay 2D cobre esse caso"). Os "Highlights" (aces, clutches, multi-kills) já são detectados automaticamente no parse e têm link direto pro momento exato dentro do Replay 2D (canvas 2D, desenhado a partir das posições extraídas da demo — não é vídeo do jogo).

Filippe pediu para reabrir essa decisão: quer que o sistema **grave a tela real do CS2** rodando a demo, gerando um `.mp4` de verdade — igual ao que o Allstar.gg entrega — para decidir com o grupo se vale o investimento. Este documento é o resultado de uma pesquisa técnica e de custo dedicada a essa pergunta, feita antes de qualquer código ser escrito.

## O que a pesquisa confirmou

*(pesquisa multi-fonte com verificação adversarial de cada afirmação — 22 fontes lidas, 25 afirmações centrais checadas por 3 verificadores independentes cada)*

### 1. Não existe hoje um jeito 100% automático de gerar vídeo a partir de uma demo do CS2

As ferramentas públicas que fazem "demo → vídeo" para CS2 (`Demo2Video`, `CS2-Highlight-Automator-for-OBS`, no GitHub) funcionam de um jeito só: **abrem o `cs2.exe` de verdade, com interface gráfica**, reproduzem a demo, e um programa externo (OBS) grava a tela. Nenhuma delas é headless (sem tela) nem roda sozinha sem configuração manual antes de cada uso — precisam do caminho do arquivo, credenciais do OBS, etc. Não achamos nenhuma ferramenta pública que renderize vídeo *sem* rodar o jogo de verdade.

Existe um produto comercial (DEMO-SLAP) que promete algo parecido, mas não temos confirmação independente de como ele funciona por dentro — só o marketing do próprio site.

**O que isso significa pro Resenha:** pra gerar vídeo real, o sistema precisaria literalmente **abrir o CS2 numa máquina na nuvem com placa de vídeo**, como se fosse um computador jogando sozinho.

### 2. O maior risco não é técnico nem de custo — é a conta Steam poder ser banida permanentemente

Isso é o ponto mais importante deste documento.

O **Steam Subscriber Agreement** (o termo de uso que você aceitou pra usar a Steam) proíbe explicitamente, na cláusula de "Automation": *"você não pode usar nenhuma forma de scripts, bots, macros ou outros sistemas não controlados por humano para interagir com Conteúdo e Serviços da Steam de qualquer maneira"*. E na cláusula de "Cheating": *"você não vai adulterar a execução da Steam ou de Conteúdo e Serviços sem autorização da Valve"*.

Rodar o CS2 de forma automatizada, numa VM, sem um humano jogando — mesmo que seja só pra reproduzir uma demo e gravar a tela, sem tocar em partida online nenhuma — se encaixa exatamente nessa cláusula.

A consequência é grave e **irreversível**: banimentos VAC são tratados pela própria Valve como **permanentes, não-negociáveis e impossíveis de remover pelo Suporte Steam** — confirmado tanto no texto oficial quanto em cobertura jornalística de uma onda recente de banimento em massa (960 mil contas banidas em um único dia por automação, abril de 2026).

**Na prática:** a conta Steam usada pra rodar esse pipeline corre risco real de ser banida de forma definitiva — perdendo inventário, rank, biblioteca de jogos, tudo vinculado àquela conta. Se for a tua conta pessoal (a que você joga), é ela que fica em risco.

### 3. O custo de infraestrutura, isoladamente, é baixo — não é o que trava o projeto

Preços reais de julho de 2026, conferidos direto nas páginas oficiais:

| Provedor | Instância | GPU | Preço |
|---|---|---|---|
| AWS | g4dn.xlarge | NVIDIA T4 | US$0,526/h (on-demand) · ~US$0,26/h (spot) |
| AWS | g5.xlarge | NVIDIA A10G | US$1,006/h (on-demand) |
| Runpod | — | NVIDIA L4 | US$0,39/h (Secure Cloud) · US$0,44/h (Community) |
| Vast.ai | — | variável (marketplace) | preço flutua por oferta/demanda em 40+ datacenters |

Considerando o tempo de ligar a instância + carregar o jogo (CS2 é pesado pra carregar) + reproduzir o trecho da demo + gravar + salvar — uma estimativa realista fica entre **5 e 10 minutos de máquina ligada por clipe**. Isso dá algo entre **US$0,03 e US$0,17 por clipe** (R$0,17 a R$0,95, câmbio aproximado). Pra um grupo pequeno gerando algumas dezenas de clipes por semana, o custo mensal de GPU ficaria na faixa de **R$15 a R$80/mês** — baixo.

**Mas isso não conta tudo:** o jogo (~40-50GB instalado) precisa estar pronto na máquina — ou se baixa toda vez (minutos a mais por clipe, inviável) ou se mantém um disco persistente pré-configurado (custo adicional pequeno, ~US$2-4/mês de armazenamento, mas soma complexidade operacional). E não inclui o tempo de engenharia pra construir e manter esse pipeline, que é o verdadeiro custo aqui — não o dólar da nuvem.

### 4. Não sabemos, com confiança, como o Allstar.gg faz isso de verdade — MAS existe um jeito de usar o trabalho deles sem replicá-lo

Não achamos nenhum post técnico, entrevista de engenharia ou documentação pública que explique a arquitetura interna do Allstar, Scope.gg ou Leetify pra esse problema especificamente.

Uma pista (não verificada de forma independente — vem do próprio material de ajuda do Allstar, então trato como indício, não fato confirmado): o FAQ deles menciona que processam dados de **GOTV depois da partida acabar** (não é captura de tela ao vivo de alguém jogando), rodando em **servidores VAC-secured** com **Trusted Mode via assinatura Authenticode conforme especificação da própria Valve**.

Se isso for preciso, sugere que o Allstar tem algum tipo de **integração autorizada/especial com a Valve** para rodar servidores de confiança que reproduzem demos — não é um script escondido rodando numa VM qualquer. Esse é exatamente o tipo de acesso que uma empresa consegue negociar e um projeto pessoal, sozinho, não tem como replicar.

**E é exatamente por isso que não precisamos replicar.** O Allstar (e pelo menos um concorrente menor) **vende esse trabalho pronto como API** — pesquisa adicional (2026-07-19) confirmou:

- **Allstar tem um Developer Portal oficial** (`developer.allstar.gg`, self-serve onboarding) que integra CS2, League of Legends, Fortnite e Dota 2. A própria página do produto lista, como integrações "seamless" já em produção: **Leetify, FACEIT, U.gg, HLTV, Refrag, Overwolf, TRN** — ou seja, **concorrentes diretos do Resenha já usam essa API pra gerar os clipes deles**, em vez de construir a captura de tela por conta própria.
- Confirmação independente: um post do blog do próprio Leetify menciona que, desde **fevereiro de 2026, o Allstar passou a cobrar por clipe** do Leetify — prova de que essa integração é real, está em produção, e tem custo por uso (não é gratuita ilimitada). O valor exato por clipe não está publicado; a página de desenvolvedor menciona "primeiros 1.000 clipes grátis" num anúncio de produto, mas não achamos a tabela de preço completa pós-cota grátis.
- Existe também a **Rankacy Highlights API** (`highlights-api.rankacy.com`), uma alternativa menor: REST API real, recebe upload do `.dem`, devolve link assinado de `.mp4` (720p-4K, 24-60fps), com endpoint próprio pra **estimar o custo antes de renderizar** (`/api/public/v1/highlights/cost`) — sinal de um modelo pay-per-render. A documentação alega que o serviço **não roda o jogo real**, fazendo "parsing e indexação de rounds" pra gerar o vídeo por outro método — não confirmamos essa alegação de forma independente (vem do próprio site deles), mas é tecnicamente plausível e, se verdade, elimina o risco de ban por completo (nem usa conta Steam nenhuma).
- Achamos também ferramentas gratuitas mas **manuais, sem API** (CLUTCHKINGS.gg, GoClipIt) — boas pra um jogador colar o link de um clipe pontual (o que o Resenha já suporta hoje via link externo), mas não servem pra automação.

**O que isso muda:** dá pra ter clipe em vídeo real **sem construir nem manter nenhuma infraestrutura de renderização, sem tocar no CS2, e sem risco de ban** — o Resenha só precisaria: enviar a demo (ou o `.dem` já arquivado no R2) pra API do Allstar (ou Rankacy) no momento de um highlight detectado, guardar a URL do vídeo devolvido, e mostrar isso na tela da partida. É trabalho de integração (chamar uma API, tratar webhook de "renderização pronta", guardar o link) — ordens de grandeza mais simples e barato que rodar GPU/CS2 por conta própria, e sem o risco jurídico levantado nas seções acima (a Valve, o VAC ban e a automação passam a ser problema do Allstar, que aparentemente já resolveu isso de forma autorizada).

### Fluxo técnico real (confirmado — conta de parceiro criada em 2026-07-19, Partner ID `RESENHACS`)

Com acesso à doc autenticada do Allstar Developer Portal, o fluxo é mais simples do que qualquer hipótese anterior neste documento:

```http
POST https://prt.allstar.gg/api/clip_request
X-API-Key: (Server API Key do dashboard)
Content-Type: application/json

{
  "steamId": "STEAMID64",
  "demoUrl": "VALID_MATCH_REPLAY_URL",
  "webhookUrl": "https://.../api/allstar/webhook",
  "rounds": [1],
  "username": "USERNAME",
  "useCase": "POTG"
}
```

- **Não é upload de arquivo** — é uma URL que aponta pro replay/demo, que o Allstar busca do próprio lado. Falta confirmar se aceitam a URL de download original da Valve (`replay*.valve.net/...`, a mesma que o Coletor já usa em `_baixar_e_descomprimir` — mas essa expira ~30 dias depois da partida) ou se aceitam uma URL pra um `.dem` nosso, hospedado no R2 (o Resenha já arquiva o `.dem` bruto lá — ADR-0002). Precisa confirmar com o suporte (`partners@allstar.gg`) ou testar direto.
- **`rounds`** casa 1:1 com `highlights.round_number` — dá pra pedir o clipe exatamente do round do ace/clutch detectado, sem trabalho extra de mapeamento.
- **Resposta é assíncrona via webhook** — não fica esperando a renderização. Precisa de um endpoint público novo no server (`POST /api/allstar/webhook`) que valida o `Webhook Auth` (visto no dashboard) antes de aceitar o evento, pra não deixar qualquer um forjar "clipe pronto" com um link malicioso.
- **Não precisamos armazenar o vídeo.** Exibição é via **iframe do próprio Allstar**: `https://allstar.gg/iframe?clip=CLIP_ID&known=true&platform=RESENHACS&useCase=...&UID=...`. Isso elimina toda a preocupação de storage/R2/streaming pra clipe — só guardamos o `clip_id` recebido no webhook (provavelmente numa coluna nova em `clips`, ou reaproveitando `provider = 'allstar'`) e embutimos o iframe na tela da Partida.
- **`useCase`** deve mapear pros tipos de highlight já existentes (o Dashboard mostrou toggles `POTG`, `BP` — falta descobrir o significado exato e se cobre `ace`/`clutch`/multi-kill como categorias separadas, ou se é só "melhor jogada" genérico).

### Mapa completo da API Reference (Swagger, conta de parceiro RESENHACS)

Não é um endpoint genérico como o exemplo do Getting Started sugeria — cada "use case" de CS2 tem seu **próprio endpoint POST**:

| Endpoint | Use case | Provável mapeamento pro Resenha |
|---|---|---|
| `POST /cs/clip/potg` | POTG (Play of the Game) | A melhor jogada da partida — pode virar o highlight de maior `rating`/impacto |
| `POST /cs/clip/mh` | MH (Multi-kill Highlight) | Casa com `highlights.kind` = `triple`/`quad`/`ace` |
| `POST /cs/clip/bp` | BP (Best Play?) | A confirmar |
| `POST /cs/clip/pmh` | PMH (Personal Match Highlight?) | A confirmar |
| `POST /cs/clip/pb` | PB (Personal Best?) | A confirmar |
| `POST /cs/clip/sh` | SH (Sharpshooter?) | A confirmar |

Suporte, gestão e consulta:
- `GET /cs/clip`, `GET /cs/clip/status` — buscar um clipe específico e checar status de processamento (dá pra fazer polling em vez de depender só de webhook, se quiser).
- `POST /cs/clip/reprocess` — reprocessar um clipe que falhou.
- `GET /cs/clips`, `GET /cs/clips/search` — listar/filtrar clipes.
- `GET /cs/clips/playlist`, **`GET /cs/clips/matchPlaylist`** — monta uma playlist de vários clipes de uma partida só (relevante: dá pra oferecer "assista todos os highlights dessa partida" numa tacada só, em vez de embed clipe por clipe).

**Webhooks (3 eventos distintos, não um genérico):**
- `clipSubmitted` — confirmação de que o pedido foi recebido.
- `clipProcessed` — clipe pronto (é aqui que pegamos o `clip_id` final pra guardar e montar o iframe).
- `clipErrored` — falhou (precisa tratar: marcar como falho, talvez re-tentar com `reprocess`).

**Sigla dos parâmetros de cada request** (`csPOTGRequestBody`, `csBPRequestBody`, etc.) apareceu no índice mas sem os campos expandidos — não sabemos ainda se `demoUrl` é igual em todos os use cases ou se cada endpoint pede algo diferente.

**Ainda falta descobrir antes de decidir — e a doc self-serve não vai responder isso:**
1. **Preço por clipe/uso.** Não existe em nenhuma página encontrada até agora (Getting Started, Terms — que é só o jurídico padrão, sem valores). Pra uma API de parceria feita por contrato (não self-serve com cartão de crédito), isso normalmente só vem **perguntando direto pro time comercial**.
2. **Formato exato de `demoUrl`** (URL da Valve, que expira, vs. URL do nosso R2) — precisa dos campos expandidos do schema, ou perguntar direto também.
3. **Significado exato de BP/PMH/PB/SH** e se há um plano gratuito/teste (o anúncio de produto mencionava "primeiros 1.000 clipes grátis", mas não vimos isso confirmado dentro da própria conta).

**Próximo passo recomendado:** um e-mail direto pra `partners@allstar.gg` (o contato oficial nos Termos) cobre as três lacunas de uma vez, citando o Partner ID `RESENHACS` já criado. Deixo um rascunho pronto pra você mandar (ou eu mando, se você preferir e confirmar) no fim deste documento.

### Lacunas que ficaram sem resposta pública

- Se existe um modo "dedicated server" do CS2 que reproduz uma demo GOTV sem interface gráfica (headless de verdade) — não achamos confirmação nem negação sólida.
- Se existem relatos concretos de contas banidas especificamente por esse uso (reproduzir demo automatizada, sem multiplayer) — ou se a fiscalização da Valve foca só em cheats/bots de partida online. Não achamos casos documentados desse cenário específico.
- Se captura via GPU (NVENC) funciona de forma limpa dentro de um display virtual (Xvfb) na nuvem — as poucas fontes técnicas que achamos sobre isso são inconclusivas/contraditórias.

## Recomendação

**Não construir a renderização por conta própria.** Rodar o CS2 automatizado numa VM continua sendo uma aposta ruim: risco de banimento permanente de conta Steam, sem ganho proporcional — ainda mais agora que existe caminho melhor.

**Recomendado — integrar com uma API de highlights pronta (Allstar Developer Portal em primeiro lugar):**
1. Aplicar acesso ao `developer.allstar.gg` (self-serve) e pedir a tabela de preço real por clipe (não publicada — só descoberta na conversa comercial). É o caminho validado em produção por concorrentes diretos (Leetify, FACEIT, U.gg), então o risco de execução é baixo.
2. Integração seria: no momento em que o Coletor detecta um Highlight (ace/clutch), enviar o `.dem` (já arquivado no R2) pra API, guardar o `matchId`/job id, e quando o vídeo terminar de renderizar (webhook ou polling), salvar a URL do `.mp4` na tabela `clips` (ou uma tabela nova) e mostrar na tela.
3. **Decisão de custo pro grupo:** como o preço por clipe do Allstar não é público, o próximo passo prático é abrir uma conta no Developer Portal, testar com os "primeiros clipes grátis" mencionados no anúncio deles, e trazer o preço real pra decisão financeira com o grupo — em vez de decidir às cegas com a estimativa de infra própria (que fica obsoleta com essa alternativa).
4. **Rankacy** como plano B/comparação — API mais simples, com endpoint de estimativa de custo antes de renderizar, útil pra comparar preço real lado a lado com o Allstar.

**Caminho alternativo, sem depender de terceiro nenhum — Replay 3D:** já que todas as posições, ângulos e animações da demo já são extraídos (é o que alimenta o Replay 2D hoje), dá pra reconstruir a cena do highlight em **3D estilizado com three.js** — mapa em 3D, câmera cinematográfica seguindo o jogador no momento do ace/clutch — e gravar esse canvas como vídeo/GIF. Não é a textura real do jogo, mas fica com cara de replay profissional, 100% sob nosso controle, sem depender de API externa nem de custo por clipe. Fica pra uma sessão de brainstorming própria, já que também responde a pergunta sobre three.js. Boa opção se o preço do Allstar/Rankacy não fechar as contas com o grupo.

**Ação imediata de baixo custo, em paralelo:** o roadmap já tem um "share card" (imagem estática com placar + destaque, pra colar no grupo) — dá pra fazer rápido e barato, sem nenhum dos riscos acima, e não compete com as opções de vídeo.

## Rascunho de e-mail para partners@allstar.gg

> **Assunto:** Pricing & integration questions — Partner ID RESENHACS (CS2)
>
> Hi Allstar team,
>
> We're building Resenha, a stats/replay platform for a small closed group of CS2 players (~10 users, a few dozen matches/week). We already created a partner account (Partner ID: **RESENHACS**) and read through the Getting Started guide and API Reference.
>
> Before we integrate, we'd appreciate clarity on a few points:
>
> 1. **Pricing** — what does per-clip pricing look like for a small/hobby-scale partner like us? Is there a self-serve pay-as-you-go option, or does it require a minimum monthly commitment / custom contract?
> 2. **`demoUrl` format** — for the CS2 clip request endpoints (`/cs/clip/potg`, `/cs/clip/mh`, etc.), does `demoUrl` need to be Valve's original GOTV download URL (which expires ~30 days after the match), or can it be any HTTPS URL we host ourselves (we already archive the raw `.dem` file in our own storage)?
> 3. **Use case meanings** — could you clarify what BP, PMH, PB, and SH stand for in the CS2 use cases, so we map them correctly to our own highlight types (ace, clutch, multi-kill)?
>
> Thanks for your time!

**Quem manda:** por padrão, deixo pra você mandar esse e-mail (é conversa comercial da tua conta de parceiro). Se preferir, eu posso mandar por você — só faço isso com tua confirmação explícita, já que é uma comunicação externa em teu nome.

## Fontes

- Steam Subscriber Agreement (texto oficial): https://store.steampowered.com/subscriber_agreement/
- Cobertura da onda de banimentos VAC de 2026: https://esportslegal.news/2026/04/01/valve-1-million-accounts-cs2-ban-wave/
- https://www.techpowerup.com/347806/valve-clamps-down-on-counter-strike-2-farmer-bots-with-960-000-vac-bans-in-one-day
- Demo2Video (GitHub): https://github.com/norton62/Demo2Video
- CS2-Highlight-Automator-for-OBS (GitHub): https://github.com/Keanoski/CS2-Highlight-Automator-for-OBS
- DEMO-SLAP: https://demo-slap.net/
- Preços AWS Spot: https://aws.amazon.com/ec2/spot/pricing/
- Preços g4dn.xlarge / g5.xlarge: https://instances.vantage.sh/aws/ec2/g4dn.xlarge, https://instances.vantage.sh/aws/ec2/g5.xlarge
- Preços Runpod: https://www.runpod.io/pricing
- Preços Vast.ai: https://vast.ai/pricing
- FAQ CS2 do Allstar.gg (indício não verificado de forma independente): https://help.allstar.gg/hc/en-us/articles/17552790931735-CS2-FAQ
- Allstar Developer Portal (integrações, jogos suportados): https://developer.allstar.gg/
- Anúncio de produto citando "primeiros 1.000 clipes grátis": https://allstar.gg/blog/spring-product-release-26
- Blog do Leetify confirmando cobrança por clipe do Allstar desde fev/2026: https://leetify.com/blog/get-leetify-highlight-rewards/
- Rankacy Highlights API (docs): https://highlights-api.rankacy.com/ e https://highlights-api.rankacy.com/ui/docs/
- CLUTCHKINGS.gg (gratuito, manual, sem API): https://www.clutchkings.gg/

## Decisões relacionadas

- Reabre parcialmente a decisão de `docs/BRIEF.md` / `docs/ROADMAP.md` ("a plataforma não renderiza vídeo") — **mantida** por ora, com esta ADR documentando o motivo específico da rejeição (risco de conta, não falta de vontade).
- Alternativa recomendada (Replay 3D com three.js) a ser levada para uma sessão de brainstorming dedicada.
