# Funcionalidades

O Resenha é o site do grupo. O Jogador entra com a Steam, cadastra o código de autenticação e as Partidas aparecem sozinhas. Quem não está logado vê a landing em `/`.

Termos: [produto/CONTEXT.md](produto/CONTEXT.md).

## Entrar e conta

| Rota | O que faz |
|---|---|
| `/` | Sem sessão, a landing. Com sessão e tour feito, o feed de Partidas |
| `/entrar` | Login Steam OpenID. O cookie `resenha_token` é httpOnly |
| `/acesso-negado` | Steam autenticada fora da whitelist |
| `/tour` | Primeiro acesso: explica o site e marca o tour como feito |
| `/conta` | Perfil do Jogador logado, vínculo FACEIT e sessão |
| `/jogadores` | Amizades do grupo |
| `/jogador/:steamId` | Perfil público dentro do grupo: histórico e stats |
| `/admin` | Super admin: whitelist e manutenção |
| `/partidas-pro` | Fila de demos profissionais (HLTV), só super admin |
| `/apoie` | Doação (Pix) |

## Partida, stats e Replay 2D

| Rota | O que faz |
|---|---|
| `/` (logado) | Feed: Partidas do grupo, resultado, mapa |
| `/partida/:id` | Placar, economia, lado CT/T, Highlights e Replay 2D |
| `/replay-demo` | Replay de demonstração, sem sessão |
| `/ranking` | Ranking do grupo e recortes por mapa e lado |
| `/comparar` | Head-to-head entre dois Jogadores |
| `/enviar-demo` | Upload de Demo (FACEIT, GC ou arquivo) para o Coletor processar |

O Highlight (ace, clutch, multi-kill) nasce no parse. O Clipe é um vídeo externo (Allstar, Medal, YouTube) que o Jogador anexa. A plataforma não renderiza vídeo.

## Biblioteca

| Rota | O que faz |
|---|---|
| `/clipes` | Clipes do grupo, com filtro por Jogador e uso em competição |
| `/competicoes` | Competição interna: prazo, prêmio e seletor de Clipes |
| `/granadas` | Lineups de smoke, flash e molotov por mapa |
| `/taticas` | Táticas curadas, com mini-radar |
| `/curso` | Curso de mira: aulas em vídeo no R2 e progresso por Jogador |

## O que não é tela

O Coletor (GitHub Actions, a cada 10 minutos) descobre Share Codes, baixa o Demo, parseia e grava stats, Highlight e o JSON do Replay 2D. O bot Node só resolve o Share Code no Game Coordinator; quem grava é o Coletor.
