import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import { iniciarPosthog } from './observabilidade/posthog.js'
import { iniciarSentry } from './observabilidade/sentry.js'
import './index.css'

// Registro do service worker (FIL-57). Precisa vir daqui, e nao do script que o
// vite-plugin-pwa injetaria no index.html: aquele script so chama register() e nao
// recarrega nada. Como o SW usa skipWaiting + clientsClaim, o SW novo assume uma aba
// que ainda esta rodando o bundle antigo — e o cleanupOutdatedCaches ja apagou os
// chunks velhos do precache, que a Vercel tambem nao serve mais depois do deploy.
// Sem recarregar, um import dinamico disparado por essa aba nao acha o chunk em lugar
// nenhum. E este modulo que traz o auto-reload prometido pelo registerType 'autoUpdate'.
//
// Guarda contra loop de reload: ele recarrega no evento 'activated' do workbox-window
// so quando isUpdate/isExternal e verdadeiro, ou seja, so quando havia um SW anterior
// controlando a pagina. Primeira instalacao nao recarrega, e depois do reload o SW novo
// ja esta ativo — nao ha novo 'activated' pra disparar de novo.
//
// Em `npm run dev` o modulo virtual e uma versao no-op: nada e registrado.
registerSW({ immediate: true })

await iniciarSentry()
iniciarPosthog()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
