import { useCallback, useEffect, useRef, useState } from 'react'

// Duração/easing únicos pra toda transição de entrada/saída de modal do produto —
// ver DESIGN.md ("elementos transitórios e flutuantes" ganham fade de entrada, nunca
// aparecem/somem do nada). Mantido num único lugar pra garantir consistência entre
// os modais de granadas/táticas (FormGranada, DetalheGranada, FormTatica,
// DetectarTaticas, DetalheTatica).
export const DURACAO_TRANSICAO_MODAL = 200

// `visivel` controla as classes de entrada (fade + scale, ver uso nos componentes).
// Começa false e vira true um frame depois de montar — se começasse true já no
// primeiro render, o browser aplicaria o estado final direto, sem transição.
//
// `iniciarSaida(aoFechar)` decora o fechamento de verdade: reverte `visivel` pra
// tocar a transição de saída e só chama `aoFechar` (que normalmente desmonta o
// modal no componente pai) depois da duração — senão o modal sumiria do DOM antes
// da animação rodar. Serve tanto pra fechar cancelando quanto pra fechar salvando,
// então todo caminho de saída do modal anima igual.
export function useTransicaoModal() {
  const [visivel, setVisivel] = useState(false)
  const emSaidaRef = useRef(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisivel(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const iniciarSaida = useCallback((aoFechar) => {
    if (emSaidaRef.current) return // já saindo — ignora clique duplicado (X + backdrop, etc.)
    emSaidaRef.current = true
    setVisivel(false)
    // O delay do unmount é um setTimeout em JS, não CSS — a regra global de
    // prefers-reduced-motion (que zera durações de transition/animation) não
    // alcança ele. Zera na mão pra não deixar o modal "pairando" invisível por
    // 200ms depois que o usuário já pediu pra fechar.
    const semAnimacao = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setTimeout(aoFechar, semAnimacao ? 0 : DURACAO_TRANSICAO_MODAL)
  }, [])

  return { visivel, iniciarSaida }
}
