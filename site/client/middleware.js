// Vercel Routing Middleware (nao e Next.js) — roda antes dos rewrites estaticos do
// vercel.json e tem acesso a env vars em tempo de REQUEST. Existe porque o vercel.json
// puro nao suporta interpolar env var no "destination" de um rewrite (e so JSON estatico
// resolvido em build), entao a unica forma de o destino do proxy /api/* variar por
// ambiente (Production vs Preview vs Development) e via codigo aqui.
//
// Historico do bug: o rewrite de /api/* ficava hardcoded pra URL de PRODUCAO da API, e
// todo Preview Deployment (PR aberto, branch de teste) acabava falando com o backend e o
// banco de dados REAIS. Agora o destino depende de VERCEL_ENV (a Vercel injeta sozinha,
// sem precisar configurar nada) — Preview/Development so atingem uma API se alguem
// configurar PREVIEW_API_URL no dashboard da Vercel (Project Settings → Environment
// Variables, escopo Preview/Development); sem isso, bloqueia em vez de vazar pra prod.
import { rewrite } from '@vercel/functions'

export const config = { matcher: '/api/:path*' }

// Projeto "site/server" na Vercel (producao) — fixo de proposito: e o unico ambiente que
// deve sempre ter um destino certo, independente de env var configurada ou nao.
const PRODUCTION_API_URL = 'https://resenhacs.vercel.app'

// Decide o destino do proxy /api/* — extraida do handler pra poder testar sem depender
// do runtime Edge da Vercel (Request/Response globais so existem la).
export function resolveApiOrigin(env = process.env) {
  if (env.VERCEL_ENV === 'production') return PRODUCTION_API_URL
  return env.PREVIEW_API_URL || null
}

export default function middleware(request) {
  const origin = resolveApiOrigin(process.env)

  if (!origin) {
    // Sem staging configurado: falha explicito (503) em vez de proxiar pro banco real.
    return new Response(
      'API indisponivel neste ambiente de preview. Configure PREVIEW_API_URL nas ' +
        'Environment Variables do projeto na Vercel (escopo Preview/Development) ' +
        'apontando pra um backend de staging.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  }

  const url = new URL(request.url)
  return rewrite(new URL(url.pathname + url.search, origin))
}
