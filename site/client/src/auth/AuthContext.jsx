import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { esquecerJogador, identificarJogador } from '../observabilidade/posthog.js'

const AuthContext = createContext({ carregando: true, jogador: null })

// Visita anônima não chama reset. Reset só quando havia um id e ele some ou troca.
export function sincronizarPosthog(idAnterior, jogador) {
  const id = jogador?.steamId != null && jogador.steamId !== '' ? String(jogador.steamId) : null
  if (id) {
    if (idAnterior && idAnterior !== id) esquecerJogador()
    if (id !== idAnterior) identificarJogador(id)
    return id
  }
  if (idAnterior) esquecerJogador()
  return null
}

export function AuthProvider({ children }) {
  const [estado, setEstado] = useState({ carregando: true, jogador: null })
  const idPosthog = useRef(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((jogador) => {
        if (!vivo) return
        setEstado({ carregando: false, jogador })
        idPosthog.current = sincronizarPosthog(idPosthog.current, jogador)
      })
      .catch(() => {
        if (vivo) setEstado({ carregando: false, jogador: null })
      })
    return () => {
      vivo = false
    }
  }, [])

  return <AuthContext.Provider value={estado}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
