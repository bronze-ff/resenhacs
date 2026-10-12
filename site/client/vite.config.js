import { defineConfig, loadEnv } from 'vite'
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
//   1. remover o VitePWA(...) daqui e o registro em src/main.jsx (senao o build
//      sobrescreve o passo 2);
//   2. criar site/client/public/sw.js com:
//        self.addEventListener('install', (event) => {
//          event.waitUntil(self.skipWaiting())
//        })
//        self.addEventListener('activate', (event) => {
//          event.waitUntil((async () => {
//            const chaves = await caches.keys()
//            await Promise.all(chaves.map((chave) => caches.delete(chave)))
//            await self.registration.unregister()
//            const abas = await self.clients.matchAll({ type: 'window' })
//            abas.forEach((aba) => aba.navigate(aba.url))
//          })())
//        })
//   3. deployar. O browser busca /sw.js sozinho na proxima visita, troca pelo SW
//      vazio, ele limpa os caches, se desregistra e recarrega as abas abertas.
// O event.waitUntil() nao e detalhe de estilo: devolver promise de um listener
// `async` NAO estende o ciclo de vida do evento, entao sem ele o browser pode
// encerrar o worker no primeiro await e deixar o SW antigo no ar — justamente no
// procedimento que nao pode falhar.
// O passo 2 precisa manter o caminho /sw.js — e o caminho que os aparelhos ja
// registrados vao consultar.
function ambienteBuild(mode) {
  if (process.env.VITE_SENTRY_ENVIRONMENT) return process.env.VITE_SENTRY_ENVIRONMENT
  if (process.env.VERCEL_ENV === 'production') return 'producao'
  if (process.env.VERCEL_ENV === 'preview') return 'homologacao'
  return mode === 'production' ? 'producao' : 'dev'
}

export default defineConfig(async ({ mode }) => {
  // .env não aparece em process.env. Sem isto, o define abaixo apaga VITE_* do arquivo.
  const envArquivo = loadEnv(mode, process.cwd(), 'VITE_')
  const plugins = [
    react(),
    tailwindcss(),
    VitePWA({
      // 'autoUpdate' + skipWaiting/clientsClaim: publicar versao nova nao deixa
      // ninguem preso na antiga — a troca acontece sozinha, no maximo no segundo
      // carregamento, sem precisar pedir pro usuario fechar o app.
      registerType: 'autoUpdate',
      // O registro vem do src/main.jsx via 'virtual:pwa-register' — nao deixar o
      // plugin injetar tambem, senao o SW seria registrado duas vezes. O script
      // que o plugin injetaria e um register cru, sem reload: e o modulo virtual
      // que implementa o auto-reload prometido pelo registerType 'autoUpdate'.
      // Efeito colateral bem-vindo: o index.html do repositorio (com os preconnect
      // do allstar.gg e das fontes) continua intacto, nada e injetado nele.
      injectRegister: null,
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
  ]
  // Source map só sobe quando o token E a org existem. Sem os dois, o build segue
  // e não publica .map (o deploy da Vercel não depende do Sentry).
  const token = process.env.SENTRY_AUTH_TOKEN
  const org = process.env.SENTRY_ORG
  if (token && org) {
    const { sentryVitePlugin } = await import('@sentry/vite-plugin')
    plugins.push(sentryVitePlugin({
      org,
      project: process.env.SENTRY_PROJECT || 'resenhacs-web',
      authToken: token,
      telemetry: false,
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }))
  }
  const define = {}
  if (!envArquivo.VITE_SENTRY_ENVIRONMENT) {
    define['import.meta.env.VITE_SENTRY_ENVIRONMENT'] = JSON.stringify(ambienteBuild(mode))
  }
  if (!envArquivo.VITE_SENTRY_RELEASE) {
    define['import.meta.env.VITE_SENTRY_RELEASE'] = JSON.stringify(
      process.env.VITE_SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '',
    )
  }
  return {
  plugins,
  define,
  build: { sourcemap: Boolean(token && org) },
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
  }
})
