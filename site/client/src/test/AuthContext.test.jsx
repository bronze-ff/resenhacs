import { render, screen } from '@testing-library/react'
import { useAuth, AuthProvider, sincronizarPosthog } from '../auth/AuthContext.jsx'
import { esquecerJogador, identificarJogador } from '../observabilidade/posthog.js'

vi.mock('../observabilidade/posthog.js', () => ({
  identificarJogador: vi.fn(),
  esquecerJogador: vi.fn(),
}))

function Sonda() {
  const { carregando } = useAuth()
  return <span>{carregando ? 'carregando' : 'pronto'}</span>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('PostHog no auth', () => {
  it('visita sem login não chama reset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => null }))
    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    )
    expect(await screen.findByText('pronto')).toBeInTheDocument()
    expect(esquecerJogador).not.toHaveBeenCalled()
    expect(identificarJogador).not.toHaveBeenCalled()
  })

  it('login identifica e não reseta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ steamId: '76561198000000000' }),
      }),
    )
    render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    )
    expect(await screen.findByText('pronto')).toBeInTheDocument()
    expect(identificarJogador).toHaveBeenCalledWith('76561198000000000')
    expect(esquecerJogador).not.toHaveBeenCalled()
  })

  it('reset só quando havia um id e ele some ou troca', () => {
    expect(sincronizarPosthog(null, null)).toBeNull()
    expect(esquecerJogador).not.toHaveBeenCalled()

    expect(sincronizarPosthog(null, { steamId: '765' })).toBe('765')
    expect(identificarJogador).toHaveBeenCalledWith('765')
    expect(esquecerJogador).not.toHaveBeenCalled()

    vi.clearAllMocks()
    expect(sincronizarPosthog('765', { steamId: '765' })).toBe('765')
    expect(identificarJogador).not.toHaveBeenCalled()
    expect(esquecerJogador).not.toHaveBeenCalled()

    expect(sincronizarPosthog('765', null)).toBeNull()
    expect(esquecerJogador).toHaveBeenCalledTimes(1)
    expect(identificarJogador).not.toHaveBeenCalled()

    vi.clearAllMocks()
    expect(sincronizarPosthog('765', { steamId: '999' })).toBe('999')
    expect(esquecerJogador).toHaveBeenCalledTimes(1)
    expect(identificarJogador).toHaveBeenCalledWith('999')
  })
})
