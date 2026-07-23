import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'

const CHAVE_SIDEBAR_COLAPSADA = 'resenha_sidebar_colapsada'

// `num` é derivado do índice (abaixo), nunca hardcoded — a numeração já dessincronizou
// uma vez no passado (remoção de Grupos/Ranking Público/Times deixou um "09 → 12" sem
// os itens 10/11 existirem mais em lugar nenhum) por causa de números fixos por item.
const ITENS_BASE = [
  { to: '/', end: true, label: 'Partidas', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', icone: 'ranking' },
  { to: '/enviar-demo', label: 'Enviar demo', icone: 'enviarDemo' },
  { to: '/clipes', label: 'Clipes', icone: 'clipes' },
  { to: '/competicoes', label: 'Competições', icone: 'competicoes' },
  { to: '/jogadores', label: 'Amigos', icone: 'jogadores' },
  { to: '/comparar', label: 'Comparar', icone: 'comparar' },
  // Granadas/Táticas são públicos pra visualização (só criar/editar é admin — cada
  // página já esconde os controles de edição sozinha via isSuperAdmin) — por isso
  // ficam aqui, fora do bloco condicional a isSuperAdmin logo abaixo.
  { to: '/granadas', label: 'Granadas', icone: 'granadas' },
  { to: '/taticas', label: 'Táticas', icone: 'taticas' },
  { to: '/conta', label: 'Minha conta', icone: 'perfil' },
  { to: '/curso', label: 'Curso de mira', icone: 'curso' },
]
const ITENS = ITENS_BASE.map((item, i) => ({ ...item, num: String(i + 1).padStart(2, '0') }))

// Itens admin-only, numerados em sequência aos de ITENS (ver numerarItem abaixo) —
// ficam num array separado só porque exigem o gate isSuperAdmin na renderização.
const ITENS_ADMIN = [
  { to: '/admin', label: 'Admin', icone: 'admin' },
  { to: '/partidas-pro', label: 'Partidas pro', icone: 'partidasPro' },
]

// Deriva o número (2 dígitos) do índice do item na lista combinada, em vez de
// hardcodear — assim a numeração nunca mais dessincroniza quando um item é
// adicionado/removido (ex.: a remoção de Grupos/Ranking Público/Times deixou um
// gap de "09" pra "12" que só existia porque os números eram fixos no JSX).
function numerarItem(indice) {
  return String(indice + 1).padStart(2, '0')
}

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
  enviarDemo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 3v12" />
      <path d="M7 8L12 3L17 8" />
      <path d="M4 15V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V15" />
    </svg>
  ),
  clipes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M9 9L15 12L9 15V9Z" fill="currentColor" stroke="none" />
    </svg>
  ),
  competicoes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M8 21H16" />
      <path d="M12 17V21" />
      <path d="M7 4H17V9C17 12.3137 14.7614 15 12 15C9.23858 15 7 12.3137 7 9V4Z" />
      <path d="M17 5H19.5C19.5 7 18.5 8.5 17 8.5" />
      <path d="M7 5H4.5C4.5 7 5.5 8.5 7 8.5" />
    </svg>
  ),
  jogadores: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20C3 16.6863 5.68629 14 9 14C12.3137 14 15 16.6863 15 20" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M21 20C21 17.2386 19.2091 15 17 15" />
    </svg>
  ),
  comparar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M8 4V20" />
      <path d="M16 4V20" />
      <path d="M4 9L8 5L12 9" />
      <path d="M12 15L16 19L20 15" />
    </svg>
  ),
  perfil: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20C4 15.5817 7.58172 12 12 12C16.4183 12 20 15.5817 20 20" />
    </svg>
  ),
  curso: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  ),
  apoie: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 20C12 20 4 15 4 9.5C4 6.5 6.5 4 9.5 4C11 4 12 5 12 5C12 5 13 4 14.5 4C17.5 4 20 6.5 20 9.5C20 15 12 20 12 20Z" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 3L4 6V11C4 15.4183 7.35786 19.5695 12 21C16.6421 19.5695 20 15.4183 20 11V6L12 3Z" />
      <path d="M9 12L11 14L15 10" />
    </svg>
  ),
  partidasPro: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 2L14.5 8.5L21 9L16 13.5L17.5 20L12 16.5L6.5 20L8 13.5L3 9L9.5 8.5L12 2Z" />
    </svg>
  ),
  colapsar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M15 5L9 12L15 19" />
    </svg>
  ),
  expandir: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M9 5L15 12L9 19" />
    </svg>
  ),
}

// Base fixa da barra mobile: as 4 rotas de hábito diário, não de consulta situacional
// (docs/superpowers/specs/2026-07-23-indicador-competicao-ativa-design.md) — Partidas é
// o job principal (rever a partida logo depois de jogar), Comparar resolve discussão do
// grupo via Head to Head (caso de uso citado explicitamente no PRODUCT.md), Clipes está
// ligado ao fluxo de Competições. Granadas/Táticas (consulta situacional, ex.: lineup de
// smoke antes de um round) continuam acessíveis pelo menu "Mais", só saem da barra fixa.
const NAV_INFERIOR_BASE = [
  { to: '/', end: true, label: 'Partidas', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', icone: 'ranking' },
  { to: '/clipes', label: 'Clipes', icone: 'clipes' },
  { to: '/comparar', label: 'Comparar', icone: 'comparar' },
]

function itemClasse(colapsada) {
  return ({ isActive }) =>
    `group flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm uppercase tracking-wide transition-colors ${
      colapsada ? 'lg:justify-center lg:px-0' : ''
    } ${
      isActive
        ? 'border-destaque bg-destaque/10 text-texto'
        : 'border-transparent text-texto-fraco hover:border-destaque/40 hover:bg-superficie-alta hover:text-texto'
    }`
}

// Ponto pulsante sobreposto ao ícone de Competições — mesmo padrão visual (bg-destaque +
// animate-pulso-sinal) já usado no aviso de sincronização de Feed.jsx:112. O texto
// sr-only garante leitura por leitor de tela sem depender só de cor/animação.
function IndicadorCompeticaoAtiva() {
  return (
    <span className="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-pulso-sinal rounded-full bg-destaque shadow-[0_0_6px_var(--color-destaque)]" />
      <span className="sr-only">Competição ativa</span>
    </span>
  )
}

export default function Shell({ children }) {
  const { jogador } = useAuth()
  const [menuAberto, setMenuAberto] = useState(false)
  const [colapsada, setColapsada] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_SIDEBAR_COLAPSADA) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_SIDEBAR_COLAPSADA, colapsada ? '1' : '0')
    } catch {
      // ignora (ex.: storage indisponível)
    }
  }, [colapsada])

  const [temCompeticaoAtiva, setTemCompeticaoAtiva] = useState(false)

  // Descobre se existe competição ativa pra acender o indicador (sidebar + barra
  // inferior mobile) — mesmo padrão de polling já usado em Feed.jsx pro aviso de
  // sincronização, intervalo maior (60s) porque início/fim de competição não muda a
  // cada segundo.
  useEffect(() => {
    let vivo = true
    function carregar() {
      fetch('/api/competicoes/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((s) => { if (vivo && s) setTemCompeticaoAtiva(Boolean(s.temAtiva)) })
        .catch(() => {})
    }
    carregar()
    const t = setInterval(carregar, 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [])

  async function sair() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/entrar'
  }

  function fecharMenu() {
    setMenuAberto(false)
  }

  const classeItem = itemClasse(colapsada)

  return (
    <div className="flex min-h-screen">
      {/* Sempre montado (não condicional): opacidade + pointer-events fazem a transição de
          entrada/saída na MESMA duração do painel (duration-200) — antes sumia/aparecia
          instantâneo enquanto o painel deslizava suavemente, duas velocidades pra uma
          única ação. */}
      <div
        className={`fixed inset-0 z-30 bg-fundo/70 transition-opacity duration-200 lg:hidden ${
          menuAberto ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={fecharMenu}
        aria-hidden="true"
      />
      {/* lg:sticky + h-screen: no desktop a sidebar vira uma coluna fixa de altura total,
          então o botão de recolher (no rodapé dela) fica SEMPRE visível sem rolar a página. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-borda bg-superficie transition-[transform,width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        } ${colapsada ? 'lg:w-16' : 'lg:w-60'}`}
      >
        <div className={`border-b border-borda px-5 py-5 ${colapsada ? 'lg:px-0 lg:text-center' : ''}`}>
          <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-texto">
            <span className={colapsada ? 'lg:hidden' : ''}>Resenha</span>
            <span className={`hidden ${colapsada ? 'lg:inline' : ''}`}>R</span>
            <span className="text-destaque">.</span>
          </h1>
          <p className={`mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-texto-fraco ${colapsada ? 'lg:hidden' : ''}`}>
            resenha cs2 // ops
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {ITENS.map((item, indice) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={classeItem}
              onClick={fecharMenu}
              title={colapsada ? item.label : undefined}
              aria-label={colapsada ? item.label : undefined}
            >
              <span className="relative shrink-0">
                {NAV_ICONES[item.icone]}
                {item.to === '/competicoes' && temCompeticaoAtiva && <IndicadorCompeticaoAtiva />}
              </span>
              <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>
                {numerarItem(indice)}
              </span>
              <span className={colapsada ? 'lg:hidden' : ''}>{item.label}</span>
            </NavLink>
          ))}
          {jogador?.isSuperAdmin && (
            <>
              {/* Separador visual dos itens admin-only, no mesmo estilo dos outros
                  rótulos micro do app (font-mono uppercase tracking largo) — a linha
                  (border-t) fica mesmo com a sidebar colapsada, só o rótulo "Admin"
                  some (como os demais textos nesse estado). */}
              <div className={`mx-3 mt-3 border-t border-borda pt-2 ${colapsada ? 'lg:mx-2' : ''}`}>
                <span className={`block pb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-texto-fraco/60 ${colapsada ? 'lg:hidden' : ''}`}>
                  Admin
                </span>
              </div>
              {ITENS_ADMIN.map((item, indice) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={classeItem}
                  onClick={fecharMenu}
                  title={colapsada ? item.label : undefined}
                  aria-label={colapsada ? item.label : undefined}
                >
                  <span className="shrink-0">{NAV_ICONES[item.icone]}</span>
                  <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>
                    {numerarItem(ITENS.length + indice)}
                  </span>
                  <span className={colapsada ? 'lg:hidden' : ''}>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="hidden border-t border-borda p-2 lg:flex">
          <button
            type="button"
            onClick={() => setColapsada((v) => !v)}
            aria-label={colapsada ? 'Expandir menu' : 'Recolher menu'}
            title={colapsada ? 'Expandir menu' : 'Recolher menu'}
            className="panel-cut-sm flex h-10 w-full cursor-pointer items-center justify-center gap-2 text-texto-fraco transition-colors duration-200 hover:bg-superficie-alta hover:text-texto"
          >
            {NAV_ICONES[colapsada ? 'expandir' : 'colapsar']}
            {!colapsada && <span className="text-[10px] font-mono uppercase tracking-wide">Recolher</span>}
          </button>
        </div>
      </aside>
      {/* min-w-0: sem isso, conteúdo com largura intrínseca maior que a tela (ex.: o
          carrossel de Resenhas) impede o flex-item de encolher, alarga o body além do
          viewport e o iOS reduz o zoom da página INTEIRA pra caber (tudo fica miúdo). */}
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-2 border-b border-borda bg-superficie/60 px-3 py-3 backdrop-blur lg:justify-end lg:gap-3 lg:px-6">
          {/* Sem hambúrguer aqui: a barra inferior mobile cobre as rotas
              principais e o botão "Mais" abre este mesmo drawer, então um
              segundo gatilho no header seria redundante. */}
          <div className="flex shrink-0 items-center gap-3 lg:hidden">
            <h1 className="font-display text-lg font-bold uppercase tracking-widest text-texto">
              Resenha<span className="text-destaque">.</span>
            </h1>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 lg:gap-3">
            <Link to={`/jogador/${jogador?.steamId}`} title="Meu perfil" className="group flex min-w-0 shrink-0 items-center gap-2">
              {jogador?.avatarUrl && (
                <img
                  src={jogador.avatarUrl}
                  alt=""
                  className="panel-cut-sm h-8 w-8 shrink-0 border border-borda object-cover transition-colors group-hover:border-destaque/60"
                />
              )}
              <span className="max-w-[64px] truncate font-mono text-sm text-texto transition-colors group-hover:text-destaque sm:max-w-none">{jogador?.nick}</span>
            </Link>
            <Link
              to="/apoie"
              title="Apoie o Resenha"
              className="panel-cut-sm flex min-h-10 shrink-0 items-center gap-1.5 border border-destaque px-2 py-1 text-xs uppercase tracking-wide text-destaque transition-colors hover:bg-destaque/10 lg:min-h-0 lg:px-2.5"
            >
              <span className="shrink-0 [&>svg]:h-5 [&>svg]:w-5 lg:[&>svg]:h-6 lg:[&>svg]:w-6">{NAV_ICONES.apoie}</span>
              <span className="hidden lg:inline">Apoie</span>
            </Link>
            <Link
              to="/tour"
              title="Como usar o Resenha"
              className="panel-cut-sm flex min-h-10 shrink-0 items-center border border-borda px-2 py-1 text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/50 hover:text-destaque lg:min-h-0 lg:px-2.5"
            >
              Ajuda
            </Link>
            <button
              onClick={sair}
              className="panel-cut-sm min-h-10 shrink-0 border border-borda px-2 py-1 text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-perigo/50 hover:text-perigo lg:min-h-0 lg:px-2.5"
            >
              Sair
            </button>
          </div>
        </header>
        <main className="px-4 pb-20 pt-4 lg:px-6 lg:py-6">{children}</main>
      </div>
      <BarraInferior menuAberto={menuAberto} onAbrirMenu={() => setMenuAberto(true)} temCompeticaoAtiva={temCompeticaoAtiva} />
    </div>
  )
}

// Barra de navegação inferior mobile (estilo app da FACEIT): fica sempre
// visível em telas pequenas (lg:hidden), abaixo do overlay (z-30) e do
// drawer (z-40) pra não competir visualmente quando o menu completo abre.
function BarraInferior({ menuAberto, onAbrirMenu, temCompeticaoAtiva }) {
  const location = useLocation()
  // Com competição ativa, Comparar cede o lugar pra Competições (mesmo indicador da
  // sidebar) — Partidas/Ranking/Clipes continuam fixos. Sem competição ativa, a barra
  // volta ao normal (docs/superpowers/specs/2026-07-23-indicador-competicao-ativa-design.md).
  const itens = temCompeticaoAtiva
    ? NAV_INFERIOR_BASE.map((item) =>
        item.to === '/comparar' ? { to: '/competicoes', label: 'Competições', icone: 'competicoes' } : item,
      )
    : NAV_INFERIOR_BASE

  function itemNavClasse({ isActive }) {
    return `flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
      isActive ? 'text-destaque' : 'text-texto-fraco'
    }`
  }

  const maisAtivo = menuAberto
  // "Mais" também deve acender quando a rota atual não é nenhum dos itens
  // principais (ex.: /jogadores, /comparar, /conta, /admin) — senão nenhum
  // ícone fica ativo nessas telas.
  const rotaCobertaPelasPrincipais = itens.some((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  )

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)] lg:hidden"
      style={{ gridTemplateColumns: `repeat(${itens.length + 1}, minmax(0, 1fr))` }}
      aria-label="Navegação principal"
    >
      {itens.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={itemNavClasse}>
          <span className="relative">
            {NAV_ICONES[item.icone]}
            {item.to === '/competicoes' && temCompeticaoAtiva && <IndicadorCompeticaoAtiva />}
          </span>
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
