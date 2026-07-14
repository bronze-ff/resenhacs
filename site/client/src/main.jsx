import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { getGrupoAtivo } from './lib/grupoAtivo.js'
import './index.css'

// Anexa X-Group-Id em toda chamada /api/ automaticamente — evita editar cada
// fetch() espalhado pelas páginas pra escopar por grupo.
const fetchOriginal = window.fetch.bind(window)
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? ''
  const grupoId = getGrupoAtivo()
  if (url.startsWith('/api/') && grupoId) {
    init = { ...init, headers: { ...(init.headers ?? {}), 'X-Group-Id': grupoId } }
  }
  return fetchOriginal(input, init)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
