// Pré-check barato do mapa antes de subir 100-300MB: o nome do mapa aparece como
// string nos primeiros KBs do .dem. É HEURÍSTICA, não garantia — no CS2 o cabeçalho
// é protobuf (PBDEMS2), sem offset fixo, então quando não achar nada a gente deixa
// passar e o Coletor decide (ele valida mapa E os 10 steam ids depois do parse).
const MAPA_RE = /de_[a-z0-9_]{2,20}/

const TRECHO_BYTES = 8192

async function lerTrecho(arquivo) {
  try {
    const buf = await arquivo.slice(0, TRECHO_BYTES).arrayBuffer()
    return new TextDecoder('latin1').decode(new Uint8Array(buf))
  } catch {
    return ''
  }
}

// Primeiro "de_*" achado no trecho — só serve pra compor a mensagem de erro (qual
// mapa é a demo que o Jogador escolheu). NÃO é a fonte da decisão de bloquear: como
// as strings do protobuf não são null-terminated, essa regex gulosa pode "vazar"
// pro byte seguinte (de_inferno + 'r' vira de_infernor) e não bate mais por
// igualdade estrita com o mapa certo. Ver cabecalhoDivergeDoMapa.
export async function mapaDoCabecalho(arquivo) {
  const texto = await lerTrecho(arquivo)
  return texto.match(MAPA_RE)?.[0] ?? null
}

// Decisão de bloqueio do pré-check, deliberadamente conservadora: só barra quando o
// trecho lido tem ALGUM nome de mapa E esse trecho NÃO contém o mapa da Partida (como
// substring — não por igualdade do match da regex, que sofre do "vazamento" acima; o
// mapa certo aparece como prefixo mesmo dentro de "de_infernor"). Se não achar nome de
// mapa nenhum, ou se a Partida não tem mapa registrado (stats-only sem Map da FACEIT),
// deixa passar — o Coletor é quem valida de verdade, depois do parse.
export async function cabecalhoDivergeDoMapa(arquivo, mapaDaPartida) {
  if (!mapaDaPartida) return false
  const texto = await lerTrecho(arquivo)
  if (!MAPA_RE.test(texto)) return false
  return !texto.includes(mapaDaPartida)
}
