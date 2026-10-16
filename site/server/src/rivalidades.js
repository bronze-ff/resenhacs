// Rivalidades de um Jogador X contra cada outro Jogador do grupo (lógica pura; a rota
// só busca as linhas). Referência: duelos do FACEIT e "Best/Worst Friend" do Leetify.
//
// Entrada: uma linha por outro Jogador com quem X dividiu alguma Partida visível:
//   { steam_id64, nick, avatar_url, matei, morri, contra, juntos, juntos_vitorias }
// matei/morri vêm de kill_positions sem team kill; contra/juntos de match_players.

// Freguês/carrasco só com amostra mínima de duelos (kills trocadas entre os dois);
// com 1–2 kills qualquer um vira "freguês" por acaso.
export const MIN_DUELOS = 5
// Dupla só conta a partir de 3 Partidas no mesmo time.
export const MIN_PARTIDAS_DUPLA = 3

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

export function calcularRivalidades(linhas) {
  const jogadores = linhas.map((r) => {
    const matei = Number(r.matei ?? 0)
    const morri = Number(r.morri ?? 0)
    const juntos = Number(r.juntos ?? 0)
    const vitoriasJuntos = Number(r.juntos_vitorias ?? 0)
    return {
      steamId: r.steam_id64,
      nick: r.nick,
      avatarUrl: r.avatar_url ?? null,
      matei,
      morri,
      saldo: matei - morri,
      // Proporção de duelos vencidos por X (0–100). null sem duelo nenhum.
      dominio: matei + morri > 0 ? pct(matei, matei + morri) : null,
      partidasContra: Number(r.contra ?? 0),
      partidasJuntos: juntos,
      vitoriasJuntos,
      winrateJuntos: juntos > 0 ? pct(vitoriasJuntos, juntos) : null,
    }
  })

  const duelos = jogadores
    .filter((j) => j.partidasContra > 0 || j.matei + j.morri > 0)
    .sort((a, b) => b.matei + b.morri - (a.matei + a.morri) || b.partidasContra - a.partidasContra)

  const comAmostra = duelos.filter((j) => j.matei + j.morri >= MIN_DUELOS)
  // Freguês: quem X mais mata proporcionalmente (desempate: mais kills em cima dele).
  const fregues = [...comAmostra]
    .filter((j) => j.matei > 0)
    .sort((a, b) => b.dominio - a.dominio || b.matei - a.matei)[0] ?? null
  // Carrasco: quem mais mata X (desempate: menor domínio de X).
  const carrasco = [...comAmostra]
    .filter((j) => j.morri > 0)
    .sort((a, b) => b.morri - a.morri || a.dominio - b.dominio)[0] ?? null

  const duplas = jogadores
    .filter((j) => j.partidasJuntos >= MIN_PARTIDAS_DUPLA)
    .sort((a, b) => b.winrateJuntos - a.winrateJuntos || b.partidasJuntos - a.partidasJuntos)
  const melhorDupla = duplas[0] ?? null
  // Pé-frio: pior winrate junto. Com uma dupla só, ela não é melhor E pior ao mesmo tempo.
  const piorDupla = duplas.length > 1
    ? [...duplas].sort((a, b) => a.winrateJuntos - b.winrateJuntos || b.partidasJuntos - a.partidasJuntos)[0]
    : null

  return { carrasco, fregues, melhorDupla, piorDupla, duelos, duplas }
}
