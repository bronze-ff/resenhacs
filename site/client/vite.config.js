import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Service worker (FIL-57): existe pra tornar o site instalavel no celular. O
// public/site.webmanifest ja estava completo ha tempos, mas sem service worker o
// Chrome do Android nao oferece "adicionar a tela inicial".
//
// COMO DESLIGAR (kill switch): service worker fica gravado no aparelho, entao
// reverter o deploy NAO basta — quem ja instalou continua com o SW antigo rodando.
// Pra desligar de verdade:
//   1. remover o VitePWA(...) daqui (senao o build sobrescreve o passo 2);
//   2. criar site/client/public/sw.js com:
//        self.addEventListener('install', () => self.skipWaiting())
//        self.addEventListener('activate', async () => {
//          await caches.keys().then((k) => Promise.all(k.map((c) => caches.delete(c))))
//          await self.registration.unregister()
//          const cs = await self.clients.matchAll({ type: 'window' })
//          cs.forEach((c) => c.navigate(c.url))
//        })
//   3. deployar. O browser busca /sw.js sozinho na proxima visita, troca pelo SW
//      vazio, ele limpa os caches, se desregistra e recarrega as abas abertas.
// O passo 2 precisa manter o caminho /sw.js — e o caminho que os aparelhos ja
// registrados vao consultar.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'autoUpdate' + skipWaiting/clientsClaim: publicar versao nova nao deixa
      // ninguem preso na antiga — a troca acontece sozinha, no maximo no segundo
      // carregamento, sem precisar pedir pro usuario fechar o app.
      registerType: 'autoUpdate',
      // Injeta o <script> de registro no index.html gerado; o index.html do
      // repositorio (com os preconnect do allstar.gg e das fontes) fica intacto.
      injectRegister: 'script-defer',
      // O public/site.webmanifest ja e o manifest oficial e o index.html ja o
      // referencia — nao gerar um segundo pra nao ficarem dois disputando.
      manifest: false,
      workbox: {
        // Precache do app shell e nada alem: JS, CSS e o HTML. Os PNGs de public/
        // (mapicons, radars, weapons) ficam de fora de proposito — sao ~2,4 MB que
        // ninguem precisa baixar antes de abrir a tela que usa cada um.
        globPatterns: ['**/*.{js,css,html}', 'favicon.ico', 'site.webmanifest'],
        // SPA com react-router-dom: navegacao pra uma rota que nao existe em disco
        // (ex.: /partidas/123) precisa cair no index.html...
        navigateFallback: 'index.html',
        // ...menos /api/*, que o middleware.js proxia pro backend. Sem esta lista o
        // fallback engoliria chamada de API e devolveria HTML.
        navigateFallbackDenylist: [/^\/api(\/|$)/],
        // Sem runtimeCaching de proposito: nenhuma resposta de /api/* entra em cache.
        // Stat de partida muda, e servir numero velho e pior que nao instalar.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
})
