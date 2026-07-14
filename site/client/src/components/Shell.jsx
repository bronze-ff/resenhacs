import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'

const ITENS = [
  { to: '/', end: true, label: 'Partidas', num: '01' },
  { to: '/ranking', label: 'Ranking', num: '02' },
  { to: '/enviar-demo', label: 'Enviar demo', num: '03' },
  { to: '/jogadores', label: 'Jogadores', num: '04' },
  { to: '/comparar', label: 'Comparar', num: '05' },
  { to: '/granadas', label: 'Granadas', num: '06' },
  { to: '/taticas', label: 'Táticas', num: '07' },
  { to: '/perfil', label: 'Meu perfil', num: '08' },
]

// Itens da barra inferior mobile (estilo app da FACEIT): 4 rotas principais
// + "Mais" que abre o drawer completo (mesmo menu do hambúrguer, agora removido
// do header mobile pra não duplicar entrada — "Mais" é o único caminho pro resto).
const NAV_ICONES = {
  partidas: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="14" y2="18" />
    </svg>
  ),
  ranking: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M4 21V13H9V21" />
      <path d="M9 21V9H15V21" />
      <path d="M15 21V15H20V21" />
    </svg>
  ),
  granadas: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  ),
  taticas: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <rect x="4" y="4" width="16" height="14" rx="1" />
      <path d="M8 9L11 12L8 15" />
      <line x1="13" y1="15" x2="16" y2="15" />
    </svg>
  ),
  mais: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
}

const NAV_INFERIOR = [
  { to: '/', end: true, label: 'Partidas', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', icone: 'ranking' },
  { to: '/granadas', label: 'Granadas', icone: 'granadas' },
  { to: '/taticas', label: 'Táticas', icone: 'taticas' },
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
  const [menuAberto, setMenuAberto] = useState(false)

  async function sair() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/entrar'
  }

  function fecharMenu() {
    setMenuAberto(false)
  }

  return (
    <div className="flex min-h-screen">
      {menuAberto && (
        <div
          className="fixed inset-0 z-30 bg-fundo/70 lg:hidden"
          onClick={fecharMenu}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-borda bg-superficie transition-transform duration-200 lg:static lg:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
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
            <NavLink key={item.to} to={item.to} end={item.end} className={itemClasse} onClick={fecharMenu}>
              <span className="font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque">
                {item.num}
              </span>
              {item.label}
            </NavLink>
          ))}
          {jogador?.isAdmin && (
            <>
              <NavLink to="/admin" className={itemClasse} onClick={fecharMenu}>
                <span className="font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque">09</span>
                Admin
              </NavLink>
              <NavLink to="/partidas-pro" className={itemClasse} onClick={fecharMenu}>
                <span className="font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque">10</span>
                Partidas pro
              </NavLink>
            </>
          )}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-borda bg-superficie/60 px-4 py-3 backdrop-blur lg:justify-end lg:px-6">
          {/* Sem hambúrguer aqui: a barra inferior mobile cobre as rotas
              principais e o botão "Mais" abre este mesmo drawer, então um
              segundo gatilho no header seria redundante. */}
          <div className="flex items-center gap-3 lg:hidden">
            <h1 className="font-display text-lg font-bold uppercase tracking-widest text-texto">
              Resenha<span className="text-destaque">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
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
          </div>
        </header>
        <main className="px-4 pb-20 pt-4 lg:px-6 lg:py-6">{children}</main>
      </div>
      <BarraInferior menuAberto={menuAberto} onAbrirMenu={() => setMenuAberto(true)} />
    </div>
  )
}

// Barra de navegação inferior mobile (estilo app da FACEIT): fica sempre
// visível em telas pequenas (lg:hidden), abaixo do overlay (z-30) e do
// drawer (z-40) pra não competir visualmente quando o menu completo abre.
function BarraInferior({ menuAberto, onAbrirMenu }) {
  const location = useLocation()

  function itemNavClasse({ isActive }) {
    return `flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
      isActive ? 'text-destaque' : 'text-texto-fraco'
    }`
  }

  const maisAtivo = menuAberto
  // "Mais" também deve acender quando a rota atual não é nenhuma das 4
  // principais (ex.: /jogadores, /comparar, /perfil, /admin) — senão nenhum
  // ícone fica ativo nessas telas.
  const rotaCobertaPelasPrincipais = NAV_INFERIOR.some((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  )

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Navegação principal"
    >
      {NAV_INFERIOR.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={itemNavClasse}>
          {NAV_ICONES[item.icone]}
          {item.label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onAbrirMenu}
        aria-label="Mais opções"
        aria-expanded={menuAberto}
        className={`flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
          maisAtivo || !rotaCobertaPelasPrincipais ? 'text-destaque' : 'text-texto-fraco'
        }`}
      >
        {NAV_ICONES.mais}
        Mais
      </button>
    </nav>
  )
}
