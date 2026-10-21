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

  // Agregados do período (Perfil, Ranking, Comparar). Regras em site/server/src/agregados.js.
  ratingPeriodo: {
    nome: 'Rating',
    texto: 'Média do rating das partidas do período, ponderada por rounds: partida de 30 rounds pesa mais que uma de 16. Rating é a nota única do desempenho (aproximação do HLTV Rating 1.0).',
    unidade: 'nota; 1.00 é a média de um jogador comum',
    sentido: 'mais',
  },
  kd: { nome: 'K/D', texto: 'Kills divididas por mortes. 1.20 = 6 kills a cada 5 mortes.', unidade: 'kills por morte', sentido: 'mais' },
  winrate: { nome: 'Winrate', texto: 'Vitórias ÷ (vitórias + derrotas). Empate não entra na conta.', unidade: '% das partidas decididas', sentido: 'mais' },
  partidas: { nome: 'Partidas', texto: 'Partidas jogadas no período.', unidade: 'partidas' },
  killsTotal: { nome: 'Kills', texto: 'Total de abates no período. Embaixo, o total de mortes.', unidade: 'abates', sentido: 'mais' },
  killsPartida: { nome: 'Kills/partida', texto: 'Kills do período ÷ partidas.', unidade: 'kills por partida', sentido: 'mais' },
  hsPeriodo: { nome: 'HS%', texto: 'Das kills do período, quantas foram com tiro na cabeça.', unidade: '% das kills', sentido: 'mais' },
  adrPeriodo: {
    nome: 'ADR',
    texto: 'Dano médio por round (average damage per round): todo o dano em inimigos do período ÷ rounds jogados.',
    unidade: 'pontos de vida por round; 100 = um inimigo inteiro por round',
    sentido: 'mais',
  },
  precisao: {
    nome: 'Precisão',
    texto: 'Tiros que acertaram alguém ÷ tiros disparados. Só armas de fogo; granada e faca ficam de fora.',
    unidade: '% dos tiros',
    sentido: 'mais',
  },
  danoUtilRound: { nome: 'Dano de utilitária', texto: 'Dano de HE, molotov e incendiária em inimigos ÷ rounds jogados. Dano no próprio time não conta.', unidade: 'pontos de vida por round', sentido: 'mais' },
  entryDuelo: {
    nome: 'Entry (1º duelo)',
    texto: 'O primeiro duelo de cada round. Em cima: duelos vencidos (matou primeiro) / duelos disputados. Embaixo, o mesmo em %.',
    unidade: 'duelos vencidos / disputados',
    sentido: 'mais',
  },
  entryWinPct: {
    nome: 'Entry win %',
    texto: 'Quando ele dá a primeira kill do round, em quantos % desses rounds o time dele vence. Não é o % de duelos de abertura ganhos. Só partidas com Demo.',
    unidade: '% dos rounds abertos por ele',
    sentido: 'mais',
  },
  entryRate: {
    nome: 'Entry rate',
    texto: 'Dos duelos de abertura (primeira kill do round) em que ele entrou, quantos ganhou. Entre parênteses: ganhos / disputados.',
    unidade: '% dos duelos de abertura',
    sentido: 'mais',
  },
  tradesPeriodo: {
    nome: 'Trades',
    texto: 'Kills em que ele vingou um colega morto nos 5 s anteriores. Embaixo, o contrário: quantas mortes dele um colega vingou.',
    unidade: 'kills',
    sentido: 'mais',
  },
  clutch: {
    nome: 'Clutch',
    texto: 'Rounds em que ele ficou por último vivo contra 1 ou mais inimigos: vencidos / tentativas. Save = perdeu o round, mas sobreviveu e salvou a arma.',
    unidade: 'vencidos / tentativas',
    sentido: 'mais',
  },
  clutchPct: { nome: 'Clutch %', texto: 'Clutches vencidos ÷ tentativas. Clutch = ficar por último vivo contra 1 ou mais inimigos.', unidade: '% das tentativas', sentido: 'mais' },
  aces: { nome: 'ACEs', texto: 'Rounds em que ele matou os 5 adversários sozinho.', unidade: 'rounds', sentido: 'mais' },
  kda: { nome: 'K/D/A', texto: 'Kills / mortes / assistências na partida.', unidade: 'abates / mortes / assistências' },
  premier: { nome: 'Premier', texto: 'CS Rating do Premier depois da última partida Premier registrada. Não segue o filtro de período.', unidade: 'pontos de CS Rating', sentido: 'mais' },
  faceitElo: { nome: 'FACEIT', texto: 'ELO atual da FACEIT. O nível (1 a 10) sai do ELO.', unidade: 'pontos de ELO', sentido: 'mais' },

  // Perfil: utilitária do período
  smokesPeriodo: { nome: 'Smokes', texto: 'Smokes jogadas no período. Não quer dizer que foram úteis.', unidade: 'granadas' },
  flashesPeriodo: {
    nome: 'Flashes',
    texto: 'Flashes jogadas no período. Embaixo, quantos inimigos cada flash cegou em média. Não é %: uma flash pode cegar vários.',
    unidade: 'granadas',
  },
  flashAssistPeriodo: {
    nome: 'Flash assist',
    texto: 'Flashes que cegaram um inimigo morto logo depois, ainda cego, por ele ou por um colega. Embaixo, o % das flashes jogadas.',
    unidade: 'flashes',
    sentido: 'mais',
  },
  hesPeriodo: { nome: 'HEs', texto: 'HEs jogadas no período. Embaixo, o dano médio em inimigos por HE jogada, não por partida.', unidade: 'granadas' },
  molotovsPeriodo: { nome: 'Molotov/Incend.', texto: 'Molotovs e incendiárias jogadas no período. Embaixo, o dano médio em inimigos por granada jogada.', unidade: 'granadas' },
  cegouInimigoPeriodo: {
    nome: 'Cegou inimigo',
    texto: 'Vezes que uma flash dele cegou um inimigo por mais de 1,1 s. Flash de raspão não conta. Embaixo, a cegueira média de cada flash que pegou alguém.',
    unidade: 'vezes',
    sentido: 'mais',
  },
  cegouAliadoPeriodo: {
    nome: 'Cegou aliado',
    texto: 'Vezes que uma flash dele cegou alguém do próprio time por mais de 1,1 s, ele mesmo incluído. Embaixo, os segundos somados.',
    unidade: 'vezes',
    sentido: 'menos',
  },
  fogoAmigoUtil: { nome: 'Fogo amigo (HE+fogo)', texto: 'Dano de HE, molotov e incendiária no próprio time, no período. Tiro em colega não entra.', unidade: 'pontos de vida', sentido: 'menos' },
  economia: {
    nome: 'Economia',
    texto: 'Dos rounds em que o time dele comprou desse jeito, quantos % o time venceu. Embaixo: vencidos / rounds.',
    unidade: '% dos rounds',
    sentido: 'mais',
  },

  // Perfil: desempenho recente (últimas 30 partidas com rating)
  mediaRecente: {
    nome: 'Média',
    texto: 'Média simples do rating das partidas do gráfico. Cada partida pesa igual, por isso pode diferir do Rating do topo, que pesa por rounds.',
    unidade: 'nota; 1.00 é a média',
    sentido: 'mais',
  },
  variacao: {
    nome: 'Variação',
    texto: 'Quanto a média da 2ª metade do gráfico mudou em relação à 1ª metade. +12,6% = a média recente está 12,6% maior.',
    unidade: '% de mudança',
    sentido: 'mais',
  },
  acimaDe1: { nome: 'Acima de 1.00', texto: 'Das partidas do gráfico, em quantas o rating ficou em 1.00 ou mais.', unidade: '% das partidas', sentido: 'mais' },

  // Perfil: pontos fortes (comparação com o grupo, últimos 90 dias)
  grupoMedia: { nome: 'Grupo', texto: 'Média do grupo nessa métrica, nos últimos 90 dias. Entra quem tem 3 ou mais partidas, ele incluído.', unidade: 'mesma unidade do número de cima' },
  percentil: {
    nome: 'Melhor que X% do grupo',
    texto: 'Dos outros jogadores do grupo, quantos % têm esse número menor que o dele. 100% = é o melhor do grupo. A barra mostra o mesmo.',
    unidade: '% dos outros jogadores',
    sentido: 'mais',
  },

  // Perfil: rivalidades (kills entre jogadores cadastrados, partidas com Demo)
  carrasco: { nome: 'Carrasco', texto: 'Quem mais matou ele. Em cima, quantas vezes. Embaixo: kills dele × mortes dele nos duelos entre os dois. Exige 5 duelos.', unidade: 'mortes', sentido: 'menos' },
  fregues: { nome: 'Freguês', texto: 'Quem ele mais domina: kills dele ÷ todos os duelos entre os dois. Embaixo: kills × mortes. Exige 5 duelos.', unidade: '% dos duelos', sentido: 'mais' },
  melhorDupla: { nome: 'Melhor dupla', texto: 'Com quem ele mais vence no mesmo time. Embaixo: vitórias / partidas juntos. Exige 3 partidas juntos.', unidade: '% de vitórias juntos', sentido: 'mais' },
  peFrio: { nome: 'Pé-frio', texto: 'Com quem ele menos vence no mesmo time. Embaixo: vitórias / partidas juntos. Exige 3 partidas juntos.', unidade: '% de vitórias juntos', sentido: 'mais' },
  matouRival: { nome: 'Matou', texto: 'Vezes que ele matou esse jogador.', unidade: 'kills' },
  morreuRival: { nome: 'Morreu', texto: 'Vezes que ele morreu para esse jogador.', unidade: 'mortes' },
  saldoRival: { nome: 'Saldo', texto: 'Matou menos morreu, contra esse jogador. Positivo: leva vantagem.', unidade: 'kills', sentido: 'mais' },
  partidasContra: { nome: 'Partidas contra', texto: 'Partidas em que os dois jogaram em times opostos.', unidade: 'partidas' },
  juntos: { nome: 'Juntos', texto: 'Partidas em que os dois jogaram no mesmo time.', unidade: 'partidas' },

  // Ranking: destaques e recordes
  forma: { nome: 'Forma', texto: '▲ = a média das 5 últimas partidas está pelo menos 0,05 acima da média da carreira. ▼ = abaixo. Exige 5 partidas com rating.', unidade: 'tendência do rating' },
  maisAces: { nome: 'Mais ACEs', texto: 'Quem fez mais ACEs (os 5 adversários num round) no período.', unidade: 'rounds', sentido: 'mais' },
  maisClutches: { nome: 'Mais clutches', texto: 'Quem venceu mais clutches no período. Embaixo: vencidos / tentativas e o %.', unidade: 'clutches', sentido: 'mais' },
  melhorWinrate: { nome: 'Melhor winrate', texto: 'Maior winrate do período, entre quem jogou 3 ou mais partidas. Empate não conta.', unidade: '% das partidas decididas', sentido: 'mais' },
  melhorClutchPct: { nome: 'Melhor clutch %', texto: 'Maior % de clutches vencidos, entre quem tentou 5 ou mais.', unidade: '% das tentativas', sentido: 'mais' },
  melhorEntry: { nome: 'Melhor entry rate', texto: 'Maior % de duelos de abertura ganhos, entre quem disputou 10 ou mais. Entre parênteses: ganhos / disputados.', unidade: '% dos duelos de abertura', sentido: 'mais' },
  recKills: { nome: 'Mais kills numa partida', texto: 'Maior número de kills de alguém do grupo numa partida só, nas últimas 750 partidas do grupo.', unidade: 'kills', sentido: 'mais' },
  recAdr: { nome: 'Melhor ADR numa partida', texto: 'Maior dano médio por round numa partida só. Só entram partidas com 10 ou mais rounds.', unidade: 'pontos de vida por round', sentido: 'mais' },
  recSequencia: { nome: 'Maior sequência de vitórias', texto: 'Mais partidas seguidas em que todo o grupo em campo venceu. Empate ou grupo dividido nos dois times quebra a sequência.', unidade: 'partidas', sentido: 'mais' },
  recClutchesResenha: { nome: 'Mais clutches numa Resenha', texto: 'Mais clutches vencidos por um jogador numa mesma sessão de jogo. Uma sessão acaba quando passam 3 h sem partida.', unidade: 'clutches', sentido: 'mais' },
  ladoCt: { nome: 'CT', texto: 'Rounds vencidos pelo grupo jogando de CT nesse mapa ÷ rounds de CT. Só partidas com o grupo todo no mesmo time.', unidade: '% dos rounds de CT', sentido: 'mais' },
  ladoT: { nome: 'T', texto: 'Rounds vencidos pelo grupo jogando de T nesse mapa ÷ rounds de T. Só partidas com o grupo todo no mesmo time.', unidade: '% dos rounds de T', sentido: 'mais' },

  // Comparar
  partidasJuntos: { nome: 'Partidas juntos', texto: 'Partidas em que os dois jogaram, no mesmo time ou em times opostos.', unidade: 'partidas' },
  mesmoTime: { nome: 'Mesmo time', texto: 'Vitórias / partidas em que os dois jogaram no mesmo time.', unidade: 'vitórias / partidas' },
  venceuContra: { nome: 'Venceu', texto: 'Partidas em times opostos que esse jogador venceu. Empates aparecem à parte.', unidade: 'partidas' },

  // Mapas
  winrateMapa: { nome: 'Winrate', texto: 'Partidas vencidas no mapa ÷ partidas decididas. Empate não conta. Embaixo, a mudança em pontos percentuais contra o período anterior.', unidade: '% das partidas', sentido: 'mais' },
  partidasMapa: { nome: 'Partidas', texto: 'Partidas no mapa no período. Embaixo: vitórias (V), derrotas (D) e empates (E).', unidade: 'partidas' },
  ladoMapa: {
    nome: 'CT e T',
    texto: 'Rounds vencidos de cada lado ÷ rounds jogados daquele lado. É % de rounds, não de partidas. A barra clara é o período anterior; o traço é a média do grupo.',
    unidade: '% dos rounds do lado',
    sentido: 'mais',
  },

  // Feed (cards de partida e sessões)
  placar: { nome: 'Placar', texto: 'Rounds do seu time × rounds do adversário.', unidade: 'rounds' },
  seuRating: { nome: 'Seu rating', texto: 'Seu rating nessa partida. ▲ acima de 1.00, ▼ abaixo.', unidade: 'nota; 1.00 é a média', sentido: 'mais' },
  doGrupo: { nome: 'Do grupo', texto: 'Quantos jogadores do seu círculo (você e seus amigos) jogaram essa partida.', unidade: 'jogadores' },
  ratingMvp: { nome: 'Rating do MVP', texto: 'Rating do MVP: quem do seu círculo teve o maior rating na partida. Empate vai para quem fez mais kills.', unidade: 'nota; 1.00 é a média', sentido: 'mais' },
  resultadoSessao: {
    nome: 'Resultado da sessão',
    texto: 'Sessão = partidas sem pausa de 3 h ou mais. V e D contam quando o grupo todo venceu ou perdeu. E = empate. Misto = grupo nos dois times.',
    unidade: 'partidas',
  },
  carregouSessao: { nome: 'Carregou a sessão', texto: 'Maior média simples de rating entre os jogadores do grupo nas partidas da sessão.', unidade: 'nota; 1.00 é a média', sentido: 'mais' },

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
    texto: 'Média de rounds vencidos por partida ficando sozinho contra 1 ou mais adversários. 0,50 = um clutch a cada duas partidas. Só entra quem jogou o mínimo de partidas.',
    unidade: 'clutches por partida',
    sentido: 'mais',
  },
  granadeiro: { nome: 'Granadeiro', texto: 'Maior dano médio de HE e molotov em inimigos por partida.', unidade: 'dano por partida', sentido: 'mais' },
  'fogo-amigo': {
    nome: 'Fogo amigo',
    texto: 'Média de vida tirada do próprio time por partida. Cada colega morto conta como 100 de dano. Só entra quem jogou o mínimo de partidas.',
    unidade: 'dano por partida',
    sentido: 'menos',
  },
  flashador: {
    nome: 'Flashador amigo',
    texto: 'Média, por partida, dos segundos em que as flashes dele cegaram o próprio time. Soma cada colega cegado (uma flash em 3 colegas por 2 s = 6 s) e inclui cegar a si mesmo.',
    unidade: 'segundos de cegueira por partida',
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

// Pontos fortes do Perfil, pelo nome que o server manda (site/server/src/pontosFortes.js).
export const METRICAS_PONTO_FORTE = {
  'Dano por round (ADR)': METRICAS.adrPeriodo,
  'Kills de headshot': METRICAS.hsPeriodo,
  'Precisão dos tiros': METRICAS.precisao,
  KAST: METRICAS.kast,
  'Duelos de entrada vencidos': METRICAS.entryRate,
  'Clutches vencidos por partida': { nome: 'Clutches por partida', texto: 'Clutches vencidos ÷ partidas jogadas.', unidade: 'clutches por partida', sentido: 'mais' },
  'Dano de utilitária por partida': { nome: 'Dano de utilitária', texto: 'Dano de HE, molotov e incendiária em inimigos ÷ partidas jogadas.', unidade: 'pontos de vida por partida', sentido: 'mais' },
  'Assistências de flash por partida': { nome: 'Flash assist', texto: 'Flashes que cegaram um inimigo morto logo depois ÷ partidas jogadas.', unidade: 'flashes por partida', sentido: 'mais' },
}

// Estilos de jogo (TagEstilo). Regra em site/server/src/analise.js: valor do jogador ÷
// média do grupo; ganha o estilo de maior razão se ela for 1,25 ou mais.
const REGRA_ESTILO = 'Comparado com a média do grupo no período, entre quem tem 3 ou mais partidas. Ganha o estilo em que mais se destaca, se ficar pelo menos 25% acima da média.'
export const METRICAS_ESTILO = {
  entry: { nome: 'Entry Fragger', texto: `Disputa muitos duelos de abertura (primeira kill ou primeira morte do round) por partida. ${REGRA_ESTILO}` },
  suporte: { nome: 'Suporte', texto: `Faz muito dano de granada em inimigos por round. ${REGRA_ESTILO}` },
  clutch: { nome: 'Jogador de Clutch', texto: `Vence muitos clutches em relação às tentativas (exige 3 tentativas). ${REGRA_ESTILO}` },
  mira: { nome: 'Mira Cirúrgica', texto: `Acerta muitos dos tiros que dá. ${REGRA_ESTILO}` },
  rifler: { nome: 'Rifler', texto: `Não fica 25% acima do grupo em entry, utilitária, clutch nem precisão. ${REGRA_ESTILO}` },
}
