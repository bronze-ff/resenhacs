import { createContext, useContext, useEffect, useState } from 'react'
import { getGrupoAtivo, setGrupoAtivo } from '../lib/grupoAtivo.js'

const AuthContext = createContext({ carregando: true, jogador: null })

export function AuthProvider({ children }) {
  const [estado, setEstado] = useState({ carregando: true, jogador: null })

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((jogador) => {
        // Primeira carga: o cache local pode estar vazio (dispositivo novo) ou
        // desatualizado (trocou de grupo em outra aba/dispositivo) — o servidor manda.
        if (jogador?.grupoAtivoId && jogador.grupoAtivoId !== getGrupoAtivo()) {
          setGrupoAtivo(jogador.grupoAtivoId)
        }
        setEstado({ carregando: false, jogador })
      })
      .catch(() => setEstado({ carregando: false, jogador: null }))
  }, [])

  return <AuthContext.Provider value={estado}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
