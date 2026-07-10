import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'

const ITENS = [
  { to: '/', end: true, label: 'Partidas', num: '01' },
  { to: '/ranking', label: 'Ranking', num: '02' },
  { to: '/enviar-demo', label: 'Enviar demo', num: '03' },
  { to: '/jogadores', label: 'Jogadores', num: '04' },
  { to: '/comparar', label: 'Comparar', num: '05' },
  { to: '/perfil', label: 'Meu perfil', num: '06' },
]

function itemClasse({ isActive }) {
  return `group flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm uppercase tracking-wide transition-colors ${
    isActive
      ? 'border-destaque bg-destaque/10 text-texto'
      : 'border-transparent text-texto-fraco hover:border-destaque/40 hover:bg-superficie-alta hover:text-texto'
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
      <aside className="flex w-60 shrink-0 flex-col border-r border-borda bg-superficie">
        <div className="border-b border-borda px-5 py-5">
          <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-texto">
            Resenha<span className="text-destaque">.</span>
          </h1>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-texto-fraco">
            resenha cs2 // ops
          </p>
        </div>
        <nav className="flex-1 py-3">
          {ITENS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={itemClasse}>
              <span className="font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque">
                {item.num}
              </span>
              {item.label}
            </NavLink>
          ))}
          {jogador?.isAdmin && (
            <NavLink to="/admin" className={itemClasse}>
              <span className="font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque">07</span>
              Admin
            </NavLink>
          )}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-borda bg-superficie/60 px-6 py-3 backdrop-blur">
          {jogador?.avatarUrl && (
            <img
              src={jogador.avatarUrl}
              alt=""
              className="panel-cut-sm h-8 w-8 border border-borda object-cover"
            />
          )}
          <span className="font-mono text-sm text-texto">{jogador?.nick}</span>
          <button
            onClick={sair}
            className="panel-cut-sm border border-borda px-2.5 py-1 text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-perigo/50 hover:text-perigo"
          >
            Sair
          </button>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
