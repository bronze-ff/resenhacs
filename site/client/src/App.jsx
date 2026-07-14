import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext.jsx'
import Shell from './components/Shell.jsx'
import Entrar from './pages/Entrar.jsx'
import AcessoNegado from './pages/AcessoNegado.jsx'
import Feed from './pages/Feed.jsx'
import Partida from './pages/Partida.jsx'
import Jogadores from './pages/Jogadores.jsx'
import JogadorPerfil from './pages/JogadorPerfil.jsx'
import Comparar from './pages/Comparar.jsx'
import Granadas from './pages/Granadas.jsx'
import Taticas from './pages/Taticas.jsx'
import Ranking from './pages/Ranking.jsx'
import EnviarDemo from './pages/EnviarDemo.jsx'
import Perfil from './pages/Perfil.jsx'
import Admin from './pages/Admin.jsx'
import PartidasPro from './pages/PartidasPro.jsx'
import ReplayDemo from './pages/ReplayDemo.jsx'

function RotaProtegida({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
  return <Shell>{children}</Shell>
}

function RotaAdmin({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
  if (!jogador.isAdmin) return <Navigate to="/" replace />
  return <Shell>{children}</Shell>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/acesso-negado" element={<AcessoNegado />} />
          <Route path="/replay-demo" element={<ReplayDemo />} />
          <Route path="/" element={<RotaProtegida><Feed /></RotaProtegida>} />
          <Route path="/partida/:id" element={<RotaProtegida><Partida /></RotaProtegida>} />
          <Route path="/ranking" element={<RotaProtegida><Ranking /></RotaProtegida>} />
          <Route path="/enviar-demo" element={<RotaProtegida><EnviarDemo /></RotaProtegida>} />
          <Route path="/jogadores" element={<RotaProtegida><Jogadores /></RotaProtegida>} />
          <Route path="/jogador/:steamId" element={<RotaProtegida><JogadorPerfil /></RotaProtegida>} />
          <Route path="/comparar" element={<RotaProtegida><Comparar /></RotaProtegida>} />
          <Route path="/granadas" element={<RotaAdmin><Granadas /></RotaAdmin>} />
          <Route path="/taticas" element={<RotaAdmin><Taticas /></RotaAdmin>} />
          <Route path="/conta" element={<RotaProtegida><Perfil /></RotaProtegida>} />
          <Route path="/admin" element={<RotaAdmin><Admin /></RotaAdmin>} />
          <Route path="/partidas-pro" element={<RotaAdmin><PartidasPro /></RotaAdmin>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
