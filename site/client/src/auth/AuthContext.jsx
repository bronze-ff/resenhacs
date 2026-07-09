import { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext({ carregando: true, jogador: null })

export function AuthProvider({ children }) {
  const [estado, setEstado] = useState({ carregando: true, jogador: null })

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((jogador) => setEstado({ carregando: false, jogador }))
      .catch(() => setEstado({ carregando: false, jogador: null }))
  }, [])

  return <AuthContext.Provider value={estado}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
