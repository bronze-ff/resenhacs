// "Pontos fortes" do Perfil: em quais stats o Jogador está mais acima do resto do
// grupo (estilo Leetify "Top stats"). Recebe um agregado por Jogador (já somado no SQL)
// e devolve os stats em que ele tem o maior percentil. Lógica pura pra testar sem banco.

function razao(a, b) {
  return b > 0 ? a / b : null
}

// `valor` recebe a linha agregada de um Jogador e devolve o stat (ou null se não dá
// pra calcular). Todos são "maior é melhor". `formato` diz como o client exibe.
export const METRICAS_PONTOS_FORTES = [
  { chave: 'adr', nome: 'Dano por round (ADR)', area: 'Impacto', formato: 'decimal1', valor: (r) => razao(Number(r.dano), Number(r.rounds)) },
  { chave: 'hs', nome: 'Kills de headshot', area: 'Mira', formato: 'pct', valor: (r) => razao(Number(r.hs), Number(r.kills)) },
  { chave: 'precisao', nome: 'Precisão dos tiros', area: 'Mira', formato: 'pct', valor: (r) => razao(Number(r.tiros_acertados), Number(r.tiros)) },
  { chave: 'kast', nome: 'KAST', area: 'Consistência', formato: 'pct100', valor: (r) => (r.kast == null ? null : Number(r.kast)) },
  { chave: 'entrada', nome: 'Duelos de entrada vencidos', area: 'Entrada', formato: 'pct', valor: (r) => razao(Number(r.entry_kills), Number(r.entry_kills) + Number(r.entry_deaths)) },
  { chave: 'clutch', nome: 'Clutches vencidos por partida', area: 'Clutch', formato: 'decimal2', valor: (r) => razao(Number(r.clutch), Number(r.partidas)) },
  { chave: 'utilitaria', nome: 'Dano de utilitária por partida', area: 'Utilitária', formato: 'inteiro', valor: (r) => razao(Number(r.util), Number(r.partidas)) },
  { chave: 'flash', nome: 'Assistências de flash por partida', area: 'Utilitária', formato: 'decimal2', valor: (r) => razao(Number(r.flash_assists), Number(r.partidas)) },
]

// Percentil = fatia dos OUTROS Jogadores do grupo que ficaram abaixo dele nesse stat.
// Precisa de pelo menos `minimoJogadores` com o stat calculável, senão "melhor que 100%
// do grupo" com 2 pessoas não diz nada.
export function pontosFortes(linhas, steamId, { quantos = 4, minimoJogadores = 3 } = {}) {
  const meu = linhas.find((l) => l.steam_id64 === steamId)
  if (!meu) return []
  const resultado = []
  for (const m of METRICAS_PONTOS_FORTES) {
    const valores = linhas
      .map((l) => ({ steamId: l.steam_id64, v: m.valor(l) }))
      .filter((x) => x.v != null && Number.isFinite(x.v))
    const eu = valores.find((x) => x.steamId === steamId)
    if (!eu || valores.length < minimoJogadores) continue
    const outros = valores.filter((x) => x.steamId !== steamId)
    const abaixo = outros.filter((x) => x.v < eu.v).length
    const media = valores.reduce((s, x) => s + x.v, 0) / valores.length
    resultado.push({
      chave: m.chave,
      nome: m.nome,
      area: m.area,
      formato: m.formato,
      valor: eu.v,
      mediaGrupo: media,
      percentil: Math.round((abaixo / outros.length) * 100),
    })
  }
  return resultado
    .sort((a, b) => b.percentil - a.percentil || b.valor / (b.mediaGrupo || 1) - a.valor / (a.mediaGrupo || 1))
    .slice(0, quantos)
}
