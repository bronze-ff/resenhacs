# ADR-0004: Viabilidade de clipes em vídeo real (estilo Allstar.gg)

**Data:** 2026-07-19
**Status:** Estudo de viabilidade — decisão pendente (aguardando o grupo)

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

### 4. Não sabemos, com confiança, como o Allstar.gg faz isso de verdade

Não achamos nenhum post técnico, entrevista de engenharia ou documentação pública que explique a arquitetura interna do Allstar, Scope.gg ou Leetify pra esse problema especificamente.

Uma pista (não verificada de forma independente — vem do próprio material de ajuda do Allstar, então trato como indício, não fato confirmado): o FAQ deles menciona que processam dados de **GOTV depois da partida acabar** (não é captura de tela ao vivo de alguém jogando), rodando em **servidores VAC-secured** com **Trusted Mode via assinatura Authenticode conforme especificação da própria Valve**.

Se isso for preciso, sugere que o Allstar tem algum tipo de **integração autorizada/especial com a Valve** para rodar servidores de confiança que reproduzem demos — não é um script escondido rodando numa VM qualquer. Esse é exatamente o tipo de acesso que uma empresa consegue negociar e um projeto pessoal, sozinho, não tem como replicar.

### Lacunas que ficaram sem resposta pública

- Se existe um modo "dedicated server" do CS2 que reproduz uma demo GOTV sem interface gráfica (headless de verdade) — não achamos confirmação nem negação sólida.
- Se existem relatos concretos de contas banidas especificamente por esse uso (reproduzir demo automatizada, sem multiplayer) — ou se a fiscalização da Valve foca só em cheats/bots de partida online. Não achamos casos documentados desse cenário específico.
- Se captura via GPU (NVENC) funciona de forma limpa dentro de um display virtual (Xvfb) na nuvem — as poucas fontes técnicas que achamos sobre isso são inconclusivas/contraditórias.

## Recomendação

**Não construir agora.** O bloqueio não é técnico nem de dinheiro — é o risco de perder permanentemente uma conta Steam por violar os termos da Valve, sem nenhuma garantia de que a fiscalização vai ou não pegar esse uso específico. É uma aposta com resultado ruim assimétrico: se der certo, ganha um vídeo bonito; se der errado, perde a conta Steam de alguém do grupo pra sempre.

**Caminho alternativo que entrega quase a mesma sensação, sem esse risco — Replay 3D:** já que todas as posições, ângulos e animações da demo já são extraídos (é o que alimenta o Replay 2D hoje), dá pra reconstruir a cena do highlight em **3D estilizado com three.js** — mapa em 3D, câmera cinematográfica seguindo o jogador no momento do ace/clutch — e gravar esse canvas como vídeo/GIF. Não é a textura real do jogo, mas fica com cara de replay profissional, roda 100% em infraestrutura própria (sem tocar no CS2, sem risco de ban) e é uma evolução natural do que já existe. Fica pra uma sessão de brainstorming própria, já que também responde tua pergunta sobre three.js.

**Ação imediata de baixo custo:** o roadmap já tem um "share card" (imagem estática com placar + destaque, pra colar no grupo) — dá pra fazer rápido e barato, sem nenhum dos riscos acima.

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

## Decisões relacionadas

- Reabre parcialmente a decisão de `docs/BRIEF.md` / `docs/ROADMAP.md` ("a plataforma não renderiza vídeo") — **mantida** por ora, com esta ADR documentando o motivo específico da rejeição (risco de conta, não falta de vontade).
- Alternativa recomendada (Replay 3D com three.js) a ser levada para uma sessão de brainstorming dedicada.
