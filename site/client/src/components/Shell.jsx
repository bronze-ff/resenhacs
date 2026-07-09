import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'

function itemClasse({ isActive }) {
  return `block rounded px-3 py-2 text-sm ${
    isActive ? 'bg-superficie text-texto' : 'text-texto-fraco hover:text-texto'
  }`
}

export default function Shell({ children }) {
  const { jogador } = useAuth()

  async function sair() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/entrar'
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-borda p-4">
        <h1 className="mb-6 text-lg font-bold text-destaque">Resenha</h1>
        <nav className="space-y-1">
          <NavLink to="/" end className={itemClasse}>Partidas</NavLink>
          <NavLink to="/jogadores" className={itemClasse}>Jogadores</NavLink>
          <NavLink to="/perfil" className={itemClasse}>Meu perfil</NavLink>
          {jogador?.isAdmin && <NavLink to="/admin" className={itemClasse}>Admin</NavLink>}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-borda px-6 py-3">
          {jogador?.avatarUrl && (
            <img src={jogador.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
          )}
          <span className="text-sm">{jogador?.nick}</span>
          <button onClick={sair} className="text-sm text-texto-fraco hover:text-texto">
            Sair
          </button>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
