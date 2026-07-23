import { Router } from 'express'
import { randomBytes, createHash } from 'node:crypto'

const AUTHORIZE_URL = 'https://accounts.faceit.com'
const TOKEN_URL = 'https://api.faceit.com/auth/v1/oauth/token'
const USERINFO_URL = 'https://api.faceit.com/auth/v1/resources/userinfo'

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Vínculo de conta FACEIT (Fase A) via OAuth2/PKCE — o jogador já está logado no Resenha
// (requireAuth montado no app.js, fora deste router, pra reaproveitar o cookie de sessão
// resenha_token já ativo); aqui só cuidamos do handshake com a FACEIT e gravamos
// faceit_id/faceit_nick no jogador identificado por req.player.steamId.
export function createFaceitRouter({ config, db, fetchImpl = fetch }) {
  const router = Router()

  router.get('/login', (req, res) => {
    if (!config.faceitClientId) return res.status(503).json({ erro: 'Vínculo FACEIT não configurado' })
    const state = base64url(randomBytes(16))
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())

    res.cookie('resenha_faceit_state', state, { httpOnly: true, secure: config.isProduction, sameSite: 'lax', maxAge: 5 * 60 * 1000 })
    res.cookie('resenha_faceit_verifier', verifier, { httpOnly: true, secure: config.isProduction, sameSite: 'lax', maxAge: 5 * 60 * 1000 })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.faceitClientId,
      redirect_uri: `${config.appUrl}/api/faceit/callback`,
      scope: 'openid profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // A FACEIT assume fluxo de POPUP por padrão: sem isso, ela autentica e fica
      // parada na própria tela "Sucesso, você pode fechar essa janela" em vez de
      // redirecionar pro redirect_uri (confirmado ao vivo). Como aqui navegamos a
      // página inteira (não popup), redirect_popup=true faz ELA redirecionar a
      // própria janela — docs.faceit.com/getting-started/authentication/oauth2.
      redirect_popup: 'true',
    })
    res.redirect(`${AUTHORIZE_URL}?${params}`)
  })

  router.get('/callback', async (req, res) => {
    const erroRedirect = `${config.appUrl}/conta?erro=faceit-invalido`
    const { code, state } = req.query
    const stateCookie = req.cookies?.resenha_faceit_state
    const verifier = req.cookies?.resenha_faceit_verifier
    res.clearCookie('resenha_faceit_state')
    res.clearCookie('resenha_faceit_verifier')
    if (!code || !state || !stateCookie || !verifier || state !== stateCookie) {
      // Log de diagnóstico (sem valores — só QUAL pré-condição falhou): a falha vira
      // um redirect genérico pro usuário, e sem isso não dá pra saber o motivo em prod.
      console.log('faceit callback rejeitado:', {
        temCode: Boolean(code), temState: Boolean(state),
        temStateCookie: Boolean(stateCookie), temVerifier: Boolean(verifier),
        stateBate: Boolean(state && stateCookie && state === stateCookie),
      })
      return res.redirect(erroRedirect)
    }

    const tokenRes = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(config.faceitClientSecret
          ? { Authorization: `Basic ${Buffer.from(`${config.faceitClientId}:${config.faceitClientSecret}`).toString('base64')}` }
          : {}),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: `${config.appUrl}/api/faceit/callback`,
        client_id: config.faceitClientId,
        code_verifier: verifier,
      }),
    })
    if (!tokenRes.ok) {
      const corpo = await tokenRes.text().catch(() => '')
      // Status + começo do corpo de erro da FACEIT (a resposta de erro não tem segredo
      // nenhum — é o suficiente pra distinguir "exige client_secret" de outra causa).
      console.log(`faceit token exchange falhou: ${tokenRes.status} ${corpo.slice(0, 300)}`)
      return res.redirect(erroRedirect)
    }
    const tokenBody = await tokenRes.json()

    const userRes = await fetchImpl(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    })
    if (!userRes.ok) {
      console.log(`faceit userinfo falhou: ${userRes.status}`)
      return res.redirect(erroRedirect)
    }
    const userBody = await userRes.json()
    const faceitId = userBody.guid ?? userBody.sub
    const faceitNick = userBody.nickname ?? null
    if (!faceitId) {
      console.log('faceit userinfo sem guid/sub:', Object.keys(userBody).join(','))
      return res.redirect(erroRedirect)
    }

    await db.query('update players set faceit_id = $2, faceit_nick = $3 where steam_id64 = $1', [
      req.player.steamId,
      faceitId,
      faceitNick,
    ])
    res.redirect(`${config.appUrl}/conta?faceit=vinculado`)
  })

  return router
}
