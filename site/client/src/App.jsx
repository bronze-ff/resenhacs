import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext.jsx'
import Shell from './components/Shell.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Entrar from './pages/Entrar.jsx'
import Landing from './pages/Landing.jsx'
import AcessoNegado from './pages/AcessoNegado.jsx'
import Feed from './pages/Feed.jsx'
import Partida from './pages/Partida.jsx'
import Amigos from './pages/Amigos.jsx'
import JogadorPerfil from './pages/JogadorPerfil.jsx'
import Comparar from './pages/Comparar.jsx'
import Clipes from './pages/Clipes.jsx'
import Competicoes from './pages/Competicoes.jsx'
import Granadas from './pages/Granadas.jsx'
import Taticas from './pages/Taticas.jsx'
import Quadro from './pages/Quadro.jsx'
import Ranking from './pages/Ranking.jsx'
import Mapas from './pages/Mapas.jsx'
import EnviarDemo from './pages/EnviarDemo.jsx'
import Perfil from './pages/Perfil.jsx'
import Admin from './pages/Admin.jsx'
import PartidasPro from './pages/PartidasPro.jsx'
import ReplayDemo from './pages/ReplayDemo.jsx'
import Tour from './pages/Tour.jsx'
import Apoie from './pages/Apoie.jsx'
import Curso from './pages/Curso.jsx'
import Privacidade from './pages/Privacidade.jsx'
import Resenha from './pages/Resenha.jsx'
import NaoEncontrada from './pages/NaoEncontrada.jsx'
import PreFila from './pages/PreFila.jsx'

// Tela de espera enquanto /api/auth/me responde: marca pulsando no centro, em vez de
// um "Carregando…" solto no canto.
function TelaCarregando() {
  return (
    <div role="status" className="flex min-h-screen flex-col items-center justify-center gap-4">
      <span aria-hidden="true" className="panel-cut-sm flex h-12 w-12 animate-pulso-sinal items-center justify-center bg-destaque font-sans text-2xl font-bold text-sobre-destaque">R</span>
      <span className="rotulo">Carregando…</span>
    </div>
  )
}

// Sem sessão, /entrar recebe a rota pedida para o login voltar a ela. A query string
// se perde (limite aceito); Entrar.jsx valida o valor antes de usar.
function IrParaEntrar() {
  const { pathname } = useLocation()
  return <Navigate to={`/entrar?returnTo=${encodeURIComponent(pathname)}`} replace />
}

// Primeiro login: o tour leva junto a rota pedida e volta para ela ao concluir.
function IrParaTour() {
  const { pathname, search } = useLocation()
  const destino = pathname + search
  return <Navigate to={destino === '/' ? '/tour' : `/tour?returnTo=${encodeURIComponent(destino)}`} replace />
}

function RotaProtegida({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <TelaCarregando />
  if (!jogador) return <IrParaEntrar />
  if (!jogador.tourConcluido) return <IrParaTour />
  return <Shell>{children}</Shell>
}

// Raiz pública: sem sessão mostra a landing (marketing), logado cai no Feed de sempre —
// mesma lógica de RotaProtegida, só que "sem jogador" não é mais um redirect, é a landing.
function RotaRaiz() {
  const { carregando, jogador } = useAuth()
  if (carregando) return <TelaCarregando />
  if (!jogador) return <Landing />
  if (!jogador.tourConcluido) return <Navigate to="/tour" replace />
  return <Shell><Feed /></Shell>
}

function RotaAdmin({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <TelaCarregando />
  if (!jogador) return <IrParaEntrar />
  if (!jogador.tourConcluido) return <IrParaTour />
  if (!jogador.isSuperAdmin) return <Navigate to="/" replace />
  return <Shell>{children}</Shell>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/acesso-negado" element={<AcessoNegado />} />
          <Route path="/replay-demo" element={<ReplayDemo />} />
          <Route path="/privacidade" element={<Privacidade />} />
          <Route path="/tour" element={<RotaTour><Tour /></RotaTour>} />
          <Route path="/" element={<RotaRaiz />} />
          <Route path="/partida/:id" element={<RotaProtegida><Partida /></RotaProtegida>} />
          <Route path="/ranking" element={<RotaProtegida><Ranking /></RotaProtegida>} />
          <Route path="/mapas" element={<RotaProtegida><Mapas /></RotaProtegida>} />
          <Route path="/pre-fila" element={<RotaProtegida><PreFila /></RotaProtegida>} />
          <Route path="/enviar-demo" element={<RotaProtegida><EnviarDemo /></RotaProtegida>} />
          <Route path="/clipes" element={<RotaProtegida><Clipes /></RotaProtegida>} />
          <Route path="/jogadores" element={<RotaProtegida><Amigos /></RotaProtegida>} />
          <Route path="/jogador/:steamId" element={<RotaProtegida><JogadorPerfil /></RotaProtegida>} />
          <Route path="/comparar" element={<RotaProtegida><Comparar /></RotaProtegida>} />
          <Route path="/competicoes" element={<RotaProtegida><Competicoes /></RotaProtegida>} />
          <Route path="/resenha" element={<RotaProtegida><Resenha /></RotaProtegida>} />
          <Route path="/granadas" element={<RotaProtegida><Granadas /></RotaProtegida>} />
          <Route path="/taticas" element={<RotaProtegida><Taticas /></RotaProtegida>} />
          <Route path="/quadro" element={<RotaProtegida><Quadro /></RotaProtegida>} />
          <Route path="/conta" element={<RotaProtegida><Perfil /></RotaProtegida>} />
          <Route path="/apoie" element={<RotaProtegida><Apoie /></RotaProtegida>} />
          <Route path="/curso" element={<RotaProtegida><Curso /></RotaProtegida>} />
          <Route path="/admin" element={<RotaAdmin><Admin /></RotaAdmin>} />
          <Route path="/partidas-pro" element={<RotaAdmin><PartidasPro /></RotaAdmin>} />
          <Route path="*" element={<RotaNaoEncontrada />} />
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  )
}

function RotaNaoEncontrada() {
  const { carregando, jogador } = useAuth()
  if (carregando) return <TelaCarregando />
  if (!jogador) return <NaoEncontrada />
  return <Shell><NaoEncontrada logado /></Shell>
}

// Tour é a única página protegida que NÃO exige tourConcluido (é ela quem zera a flag).
function RotaTour({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <TelaCarregando />
  if (!jogador) return <Navigate to="/entrar" replace />
  return children
}
