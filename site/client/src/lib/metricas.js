// Dicionário único das métricas do site: o que cada número é, em que unidade está e se
// mais é melhor. Usado pelo <Explicacao> (rótulo clicável). Uma métrica nova ganha
// entrada aqui antes de aparecer numa tela, pra nenhum número ficar sem explicação.
// sentido: 'mais' (maior é melhor), 'menos' (menor é melhor) ou ausente (neutro).

export const METRICAS = {
  // Stats da Partida (lente Geral)
  rating: {
    nome: 'Rating',
    texto: 'Nota única do desempenho, aproximação do HLTV Rating 1.0. Junta kills por round, sobrevivência e rounds com 2+ kills.',
    unidade: 'nota; 1.00 é a média de um jogador comum',
    sentido: 'mais',
  },
  k: { nome: 'Kills', texto: 'Abates na Partida. Matar alguém do próprio time ou se matar não conta.', unidade: 'abates', sentido: 'mais' },
  d: { nome: 'Mortes', texto: 'Vezes que morreu, por qualquer causa: tiro, queda, bomba ou fogo amigo.', unidade: 'mortes', sentido: 'menos' },
  a: { nome: 'Assists', texto: 'Abates em que ajudou com dano ou flash, sem dar o tiro final.', unidade: 'assistências', sentido: 'mais' },
  saldo: { nome: '+/−', texto: 'Kills menos mortes. Positivo: matou mais do que morreu.', unidade: 'abates', sentido: 'mais' },
  adr: {
    nome: 'ADR',
    texto: 'Dano médio por round (average damage per round). Soma o dano em inimigos e divide pelos rounds jogados, inclusive os rounds sem dano.',
    unidade: 'pontos de vida por round; 100 = um inimigo inteiro por round',
    sentido: 'mais',
  },
  kast: {
    nome: 'KAST',
    texto: 'Em quantos % dos rounds ele fez algo útil: kill (K), assist (A), sobreviveu (S) ou morreu e foi trocado por um colega (T).',
    unidade: '% dos rounds',
    sentido: 'mais',
  },
  hs: { nome: 'HS%', texto: 'Das kills dele, quantas foram com tiro na cabeça.', unidade: '% das kills', sentido: 'mais' },
  multi: { nome: '3K · 4K · 5K', texto: 'Quantos rounds ele fechou com 3, 4 e 5 kills (dado da FACEIT). Ex.: 2·1·0 = dois rounds de 3 kills e um de 4.', unidade: 'rounds' },
  mvps: { nome: 'MVPs', texto: 'Rounds em que o jogo escolheu ele como o melhor do time (dado da FACEIT).', unidade: 'rounds', sentido: 'mais' },
  tk: { nome: 'Fogo amigo (TK)', texto: 'Colegas de time que ele matou. Não entra em Kills nem no Rating.', unidade: 'abates', sentido: 'menos' },
  pontos: { nome: 'Pontos', texto: 'Premier ou ELO FACEIT antes da Partida. A seta mostra quanto ganhou ou perdeu nela.', unidade: 'pontos de ranking' },

  // Lente Utilitária
  smokesThrown: { nome: 'Smokes', texto: 'Smokes jogadas na Partida. Não quer dizer que foram úteis.', unidade: 'granadas' },
  flashesThrown: { nome: 'Flashes', texto: 'Flashes jogadas na Partida. Não quer dizer que cegaram alguém.', unidade: 'granadas' },
  heThrown: { nome: 'HEs', texto: 'Granadas explosivas jogadas na Partida.', unidade: 'granadas' },
  molotovsThrown: { nome: 'Molotovs', texto: 'Molotovs e incendiárias jogadas na Partida.', unidade: 'granadas' },
  cego: {
    nome: 'Cegou inimigo',
    texto: 'Quantas vezes uma flash dele cegou um inimigo por mais de 1,1 s, e o total de segundos de cegueira. Flash de raspão não conta.',
    unidade: 'vezes · segundos somados',
    sentido: 'mais',
  },
  cegoAliado: {
    nome: 'Cegou aliado',
    texto: 'Quantas vezes uma flash dele cegou alguém do próprio time (ele mesmo incluído) por mais de 1,1 s, e o total de segundos.',
    unidade: 'vezes · segundos somados',
    sentido: 'menos',
  },
  flashAssist: {
    nome: 'Flash assist',
    texto: 'Flashes dele que cegaram um inimigo morto logo depois, ainda cego. Conta também quando ele mesmo fez o abate.',
    unidade: 'flashes',
    sentido: 'mais',
  },
  danoHe: { nome: 'Dano de HE', texto: 'Dano das HEs dele em inimigos. Entre parênteses, o dano no próprio time.', unidade: 'pontos de vida', sentido: 'mais' },
  danoFogo: { nome: 'Dano de fogo', texto: 'Dano de molotov e incendiária em inimigos. Entre parênteses, o dano no próprio time.', unidade: 'pontos de vida', sentido: 'mais' },

  // Lente Duelos
  aberturas: {
    nome: 'Aberturas',
    texto: 'Duelo de abertura é a primeira kill do round. ↑ = vezes que ele deu a primeira kill. ↓ = vezes que ele foi a primeira morte.',
    unidade: 'duelos ganhos ↑ e perdidos ↓',
    sentido: 'mais',
  },
  aberturasPct: { nome: '% abertura', texto: 'Dos duelos de abertura em que ele entrou, quantos ganhou.', unidade: '% dos duelos de abertura', sentido: 'mais' },
  abCt: { nome: 'Abertura de CT', texto: 'O mesmo % de abertura, contando só os rounds em que ele jogou de CT.', unidade: '% dos duelos de abertura de CT', sentido: 'mais' },
  abT: { nome: 'Abertura de T', texto: 'O mesmo % de abertura, contando só os rounds em que ele jogou de T.', unidade: '% dos duelos de abertura de T', sentido: 'mais' },
  trocadas: {
    nome: 'Mortes trocadas',
    texto: 'Das mortes dele, quantas um colega vingou: matou quem matou ele em até 5 s. "3 de 12" = 3 das 12 mortes foram vingadas.',
    unidade: 'mortes vingadas, de quantas mortes',
    sentido: 'mais',
  },
  semTroca: { nome: 'Mortes sem troca', texto: 'Mortes em que ninguém do time vingou em até 5 s. Morrer sozinho, longe do time, aumenta esse número.', unidade: 'mortes', sentido: 'menos' },
  trocas: { nome: 'Trocas feitas', texto: 'Vezes que ele vingou um colega: matou quem tinha acabado de matar alguém do time, em até 5 s.', unidade: 'abates', sentido: 'mais' },

  // Lente Contra fulano (do ponto de vista do jogador focado)
  matou: { nome: 'Matou', texto: 'Quantas vezes o jogador focado matou esse adversário.', unidade: 'abates' },
  morreu: { nome: 'Morreu para', texto: 'Quantas vezes o jogador focado morreu para esse adversário.', unidade: 'mortes' },
  dano: { nome: 'Dano causado', texto: 'Dano total do jogador focado nesse adversário, na Partida inteira.', unidade: 'pontos de vida' },
  danoRecebido: { nome: 'Dano recebido', texto: 'Dano total que o jogador focado levou desse adversário.', unidade: 'pontos de vida' },
  cegou: { nome: 'Cegou', texto: 'Vezes que o jogador focado cegou esse adversário com flash.', unidade: 'vezes' },
  foiCegado: { nome: 'Foi cegado', texto: 'Vezes que esse adversário cegou o jogador focado com flash.', unidade: 'vezes' },

  // Números do topo da Resenha
  partidasGrupo: { nome: 'Partidas do grupo', texto: 'Partidas diferentes no período com pelo menos um jogador do seu círculo (você e seus amigos).', unidade: 'partidas' },
  horasJuntos: { nome: 'De jogo juntos', texto: 'Soma da duração dessas partidas. Partida sem a duração gravada não entra; "–" quando nenhuma tem.', unidade: 'horas' },
  winrateGrupo: { nome: 'Winrate do grupo', texto: 'Das partidas do período, em quantas o grupo venceu. Partida com o grupo dividido nos dois times não entra.', unidade: '% das partidas', sentido: 'mais' },
  clutchesGrupo: { nome: 'Clutches vencidos', texto: 'Rounds em que alguém do grupo ficou sozinho contra 1 ou mais e ganhou o round.', unidade: 'rounds', sentido: 'mais' },
}

// Prêmios da Resenha (por id do prêmio). A unidade aparece ao lado do valor no card.
export const METRICAS_PREMIO = {
  carregou: { nome: 'Carregou', texto: 'Maior rating médio do período, entre quem jogou o mínimo de partidas.', unidade: 'rating médio', sentido: 'mais' },
  clutch: {
    nome: 'Rei do clutch',
    texto: 'Total de rounds vencidos no período ficando sozinho contra 1 ou mais adversários. Embaixo, em quantas partidas.',
    unidade: 'clutches no período',
    sentido: 'mais',
  },
  granadeiro: { nome: 'Granadeiro', texto: 'Maior dano médio de HE e molotov em inimigos por partida.', unidade: 'dano por partida', sentido: 'mais' },
  'fogo-amigo': {
    nome: 'Fogo amigo',
    texto: 'Total de vida tirada do próprio time no período. Cada colega morto conta como 100 de dano. Só partidas com Demo têm esse dado.',
    unidade: 'dano no período',
    sentido: 'menos',
  },
  flashador: {
    nome: 'Flashador amigo',
    texto: 'Total de tempo em que as flashes dele cegaram o próprio time no período. Soma cada colega cegado (uma flash em 3 colegas por 2 s = 6 s) e inclui cegar a si mesmo. Só partidas com Demo têm esse dado.',
    unidade: 'de cegueira no período',
    sentido: 'menos',
  },
  baiter: {
    nome: 'Baiter',
    texto: 'Média de mortes por partida em que nenhum colega vingou em até 5 s. Só conta partidas com Demo. Não é porcentagem: 13,9 = quase 14 mortes sem troca a cada partida.',
    unidade: 'mortes por partida',
    sentido: 'menos',
  },
  alface: { nome: 'Mão de alface', texto: 'Menor % de kills com tiro na cabeça, entre quem fez o mínimo de kills.', unidade: '% das kills', sentido: 'mais' },
  dupla: { nome: 'Dupla imbatível', texto: 'Dupla que mais venceu jogando no mesmo time. Entre parênteses, vitórias / partidas juntos.', unidade: '% de vitórias juntos', sentido: 'mais' },
  'mapa-maldito': { nome: 'Mapa maldito', texto: 'Mapa com o pior winrate do grupo no período.', unidade: '% de vitórias no mapa', sentido: 'mais' },
}
