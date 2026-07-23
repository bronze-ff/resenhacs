// Helpers pra dar nome automático a granadas geradas em lote a partir das
// demos (callout mais próximo do alvo/arremesso).

const ROTULO_TIPO = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

// Callout de menor distância euclidiana até (x, y). null se a lista estiver vazia.
export function calloutMaisProximo(callouts, x, y) {
  if (!callouts?.length) return null
  let melhor = null
  let melhorDist = Infinity
  for (const c of callouts) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2
    if (d < melhorDist) {
      melhorDist = d
      melhor = c
    }
  }
  return melhor
}

// Título automático: "Smoke Connector — de Base T". Sem callouts cadastrados
// pro mapa, cai pra coordenadas em % ("Smoke em (52, 47)").
export function nomeAutomatico(tipo, callouts, alvoX, alvoY, arremessoX, arremessoY) {
  const rotulo = ROTULO_TIPO[tipo] ?? tipo
  const alvo = calloutMaisProximo(callouts, alvoX, alvoY)
  if (!alvo) return `${rotulo} em (${Math.round(alvoX * 100)}, ${Math.round(alvoY * 100)})`

  const origem = calloutMaisProximo(callouts, arremessoX, arremessoY)
  if (origem && origem.nome !== alvo.nome) return `${rotulo} ${alvo.nome} — de ${origem.nome}`
  return `${rotulo} ${alvo.nome}`
}
