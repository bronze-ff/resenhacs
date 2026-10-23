import { useEffect, useRef } from 'react'

// Repete `consultar` a cada `intervaloMs` enquanto `ligado` e a aba está visível.
// `document.hidden` pausa o timer (aba em segundo plano não gasta função na Vercel).
// Ao voltar, chama na hora e rearma o intervalo.
// `imediato` (padrão true): também chama assim que liga, se a aba já está visível.
// Com imediato false, a primeira chamada espera o intervalo — a volta da aba
// ainda dispara na hora.
export function useRepetirQuandoVisivel(consultar, intervaloMs, { ligado = true, imediato = true } = {}) {
  const consultarRef = useRef(consultar)
  consultarRef.current = consultar

  useEffect(() => {
    if (!ligado) return undefined
    let timer = null
    const parar = () => {
      if (timer == null) return
      clearInterval(timer)
      timer = null
    }
    const consultarAgora = () => consultarRef.current()
    const agendar = () => {
      parar()
      timer = setInterval(consultarAgora, intervaloMs)
    }
    if (!document.hidden) {
      if (imediato) consultarAgora()
      agendar()
    }
    const aoMudarVisibilidade = () => {
      if (document.hidden) {
        parar()
        return
      }
      consultarAgora()
      agendar()
    }
    document.addEventListener('visibilitychange', aoMudarVisibilidade)
    return () => {
      parar()
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
    }
  }, [ligado, intervaloMs, imediato])
}
