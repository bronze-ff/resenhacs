import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { esquecerJogador } from '../observabilidade/posthog.js'
import { Avatar, classesBotao } from './ui'

const CHAVE_SIDEBAR_COLAPSADA = 'resenha_sidebar_colapsada'

// Menu agrupado por intenção (analisar, comunidade, biblioteca). Os números "01…12"
// de antes saíram: viraram ruído quando a lista passou de 10 itens, e os grupos
// passam a dar a mesma orientação com menos texto.
const GRUPOS = [
  {
    titulo: 'Análise',
    itens: [
      { to: '/', end: true, label: 'Partidas', icone: 'partidas' },
      { to: '/ranking', label: 'Ranking', icone: 'ranking' },
      { to: '/comparar', label: 'Comparar', icone: 'comparar' },
      { to: '/enviar-demo', label: 'Enviar demo', icone: 'enviarDemo' },
    ],
  },
  {
    titulo: 'Comunidade',
    itens: [
      { to: '/clipes', label: 'Clipes', icone: 'clipes' },
      { to: '/competicoes', label: 'Competições', icone: 'competicoes' },
      { to: '/jogadores', label: 'Amigos', icone: 'jogadores' },
    ],
  },
  {
    // Granadas/Táticas são públicos pra visualização (só criar/editar é admin — cada
    // página já esconde os controles de edição sozinha via isSuperAdmin).
    titulo: 'Biblioteca',
    itens: [
      { to: '/granadas', label: 'Granadas', icone: 'granadas' },
      { to: '/taticas', label: 'Táticas', icone: 'taticas' },
      { to: '/curso', label: 'Curso de mira', icone: 'curso' },
    ],
  },
  {
    titulo: 'Conta',
    itens: [{ to: '/conta', label: 'Minha conta', icone: 'perfil' }],
  },
]

// Itens admin-only — grupo separado só porque exigem o gate isSuperAdmin.
const GRUPO_ADMIN = {
  titulo: 'Admin',
  itens: [
    { to: '/admin', label: 'Admin', icone: 'admin' },
    { to: '/partidas-pro', label: 'Partidas pro', icone: 'partidasPro' },
  ],
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
// grupo via Head to Head (caso de uso citado explicitamente no docs/produto/PRODUCT.md), Clipes está
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
    `group relative mx-2 flex h-9 items-center gap-2.5 rounded-[var(--radius-pequeno)] px-2.5 text-sm font-medium transition-colors duration-150 [&_svg]:h-[18px] [&_svg]:w-[18px] ${
      colapsada ? 'lg:justify-center lg:px-0' : ''
    } ${
      isActive
        ? 'bg-superficie-topo text-texto [&_svg]:text-destaque'
        : 'text-texto-fraco hover:bg-superficie-alta hover:text-texto'
    }`
}

// Marca: quadrado com corte diagonal e um "R" — mesma silhueta dos painéis.
function Marca({ tamanho = 'md' }) {
  const lado = tamanho === 'sm' ? 'h-6 w-6 text-[13px]' : 'h-7 w-7 text-sm'
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-[var(--radius-pequeno)] bg-destaque font-sans font-bold leading-none text-sobre-destaque ${lado}`}>
      R
    </span>
  )
}

// Ponto pulsante sobreposto ao ícone de Competições — mesmo padrão visual (bg-destaque +
// animate-pulso-sinal) já usado no aviso de sincronização de Feed.jsx:112. O texto
// sr-only garante leitura por leitor de tela sem depender só de cor/animação.
function IndicadorCompeticaoAtiva() {
  return (
    <span className="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-pulso-sinal rounded-full bg-destaque" />
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

  // Descobre se existe competição ativa OU agendada pra acender o indicador (sidebar +
  // barra inferior mobile) — agendada conta porque o "em breve" é exatamente o momento
  // de puxar o clique pra aba (ver regras/prêmio antes de começar). Mesmo padrão de
  // polling já usado em Feed.jsx pro aviso de sincronização, intervalo maior (60s)
  // porque início/fim de competição não muda a cada segundo.
  useEffect(() => {
    let vivo = true
    function carregar() {
      fetch('/api/competicoes/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((s) => { if (vivo && s) setTemCompeticaoAtiva(Boolean(s.temAtiva || s.temAgendada)) })
        .catch(() => {})
    }
    carregar()
    const t = setInterval(carregar, 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [])

  async function sair() {
    await fetch('/api/auth/logout', { method: 'POST' })
    esquecerJogador()
    window.location.href = '/'
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
        className={`fixed inset-0 z-30 bg-fundo/70 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
          menuAberto ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={fecharMenu}
        aria-hidden="true"
      />
      {/* lg:sticky + h-screen: no desktop a sidebar vira uma coluna fixa de altura total,
          então o botão de recolher (no rodapé dela) fica SEMPRE visível sem rolar a página. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-borda bg-fundo transition-[transform,width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        } ${colapsada ? 'lg:w-[60px]' : 'lg:w-60'}`}
      >
        <div className={`flex h-14 items-center gap-2.5 px-4 ${colapsada ? 'lg:justify-center lg:px-0' : ''}`}>
          <Marca />
          <div className={colapsada ? 'lg:hidden' : ''}>
            <h1 className="font-display text-[15px] font-semibold leading-none text-texto">Resenha</h1>
            <p className="mt-1 text-xs leading-none text-texto-fraco">CS2 do grupo</p>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto py-3" aria-label="Menu">
          {[...GRUPOS, ...(jogador?.isSuperAdmin ? [GRUPO_ADMIN] : [])].map((grupo) => (
            <div key={grupo.titulo}>
              <div className={`mb-1 px-4 text-xs font-medium text-texto-fraco/70 ${colapsada ? 'lg:hidden' : ''}`}>{grupo.titulo}</div>
              <div className={`mx-4 mb-1 hidden h-px bg-borda ${colapsada ? 'lg:block' : ''}`} aria-hidden="true" />
              <div className="space-y-0.5">
                {grupo.itens.map((item) => (
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
                    <span className={colapsada ? 'lg:hidden' : ''}>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="hidden p-2 lg:flex">
          <button
            type="button"
            onClick={() => setColapsada((v) => !v)}
            aria-label={colapsada ? 'Expandir menu' : 'Recolher menu'}
            title={colapsada ? 'Expandir menu' : 'Recolher menu'}
            className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-pequeno)] text-texto-fraco transition-colors duration-150 hover:bg-superficie-alta hover:text-texto"
          >
            {NAV_ICONES[colapsada ? 'expandir' : 'colapsar']}
            {!colapsada && <span className="text-[13px]">Recolher</span>}
          </button>
        </div>
      </aside>
      {/* min-w-0: sem isso, conteúdo com largura intrínseca maior que a tela (ex.: o
          carrossel de Resenhas) impede o flex-item de encolher, alarga o body além do
          viewport e o iOS reduz o zoom da página INTEIRA pra caber (tudo fica miúdo). */}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-borda bg-fundo/80 px-3 backdrop-blur-md lg:justify-end lg:gap-2 lg:px-6">
          {/* Sem hambúrguer aqui: a barra inferior mobile cobre as rotas
              principais e o botão "Mais" abre este mesmo drawer, então um
              segundo gatilho no header seria redundante. */}
          <div className="flex shrink-0 items-center gap-2.5 lg:hidden">
            <Marca tamanho="sm" />
            <h1 className="font-display text-[15px] font-semibold text-texto">Resenha</h1>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 lg:gap-2">
            <Link
              to="/apoie"
              title="Apoie o Resenha"
              aria-label="Apoie"
              className={classesBotao({ variante: 'contorno', tamanho: 'sm', className: 'px-2 [&_svg]:h-4 [&_svg]:w-4 lg:px-2.5' })}
            >
              {NAV_ICONES.apoie}
              <span className="hidden lg:inline">Apoie</span>
            </Link>
            <Link
              to="/tour"
              title="Como usar o Resenha"
              className={classesBotao({ variante: 'fantasma', tamanho: 'sm', className: 'px-2 lg:px-3' })}
            >
              Ajuda
            </Link>
            <span className="mx-1 hidden h-6 w-px bg-borda lg:block" aria-hidden="true" />
            <Link
              to={`/jogador/${jogador?.steamId}`}
              title="Meu perfil"
              className="group flex h-9 min-w-0 shrink-0 items-center gap-2 rounded-[var(--radius-pequeno)] py-1 pl-1 pr-2.5 transition-colors duration-150 hover:bg-superficie-alta"
            >
              <span aria-hidden="true"><Avatar p={jogador ? { ...jogador, team: null } : null} size={28} /></span>
              <span className="max-w-[56px] truncate text-[13px] font-medium text-texto sm:max-w-[140px]">{jogador?.nick}</span>
            </Link>
            <button
              onClick={sair}
              title="Sair"
              aria-label="Sair"
              className={classesBotao({ variante: 'fantasma', tamanho: 'icone', className: 'hover:!text-perigo' })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
                <path d="M10 17l-5-5 5-5M5 12h11" />
              </svg>
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-5 lg:px-10 lg:py-8">{children}</main>
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
    return `relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 [&_svg]:h-[22px] [&_svg]:w-[22px] ${
      isActive ? 'text-texto [&_svg]:text-destaque' : 'text-texto-fraco'
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
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-borda bg-fundo/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
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
        className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 [&_svg]:h-[22px] [&_svg]:w-[22px] ${
          maisAtivo || !rotaCobertaPelasPrincipais ? 'text-texto [&_svg]:text-destaque' : 'text-texto-fraco'
        }`}
      >
        {NAV_ICONES.mais}
        Mais
      </button>
    </nav>
  )
}
