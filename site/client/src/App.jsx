import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext.jsx'
import Shell from './components/Shell.jsx'
import Entrar from './pages/Entrar.jsx'
import AcessoNegado from './pages/AcessoNegado.jsx'
import Feed from './pages/Feed.jsx'
import Partida from './pages/Partida.jsx'
import Jogadores from './pages/Jogadores.jsx'
import JogadorPerfil from './pages/JogadorPerfil.jsx'
import Perfil from './pages/Perfil.jsx'
import Admin from './pages/Admin.jsx'
import ReplayDemo from './pages/ReplayDemo.jsx'

function RotaProtegida({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
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
          <Route path="/jogadores" element={<RotaProtegida><Jogadores /></RotaProtegida>} />
          <Route path="/jogador/:steamId" element={<RotaProtegida><JogadorPerfil /></RotaProtegida>} />
          <Route path="/perfil" element={<RotaProtegida><Perfil /></RotaProtegida>} />
          <Route path="/admin" element={<RotaProtegida><Admin /></RotaProtegida>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
