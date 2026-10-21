// site/client/src/test/UrlClipe.test.jsx
// Onda 1, S3b (R16): iframe de Clipe só para host da Allstar; o resto vira link seguro.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { hostPermitido, DOMINIOS_IFRAME_CLIPE } from '../lib/urlSegura.js'
import { PlayerClipe } from '../components/ui/PlayerClipe.jsx'

describe('hostPermitido', () => {
  it('aceita o domínio e subdomínios', () => {
    expect(hostPermitido('https://allstar.gg/iframe?clip=1', DOMINIOS_IFRAME_CLIPE)).toBe(true)
    expect(hostPermitido('https://www.allstar.gg/iframe?clip=1', DOMINIOS_IFRAME_CLIPE)).toBe(true)
    expect(hostPermitido('https://media.allstar.gg/x', DOMINIOS_IFRAME_CLIPE)).toBe(true)
    expect(hostPermitido('https://ALLSTAR.GG/x', DOMINIOS_IFRAME_CLIPE)).toBe(true)
  })

  it('recusa host parecido, outro protocolo e lixo', () => {
    expect(hostPermitido('https://allstar.gg.evil.com/x', DOMINIOS_IFRAME_CLIPE)).toBe(false)
    expect(hostPermitido('https://evilallstar.gg/x', DOMINIOS_IFRAME_CLIPE)).toBe(false)
    expect(hostPermitido('https://evil.com/?u=allstar.gg', DOMINIOS_IFRAME_CLIPE)).toBe(false)
    expect(hostPermitido('javascript:alert(1)//allstar.gg', DOMINIOS_IFRAME_CLIPE)).toBe(false)
    expect(hostPermitido('não é url', DOMINIOS_IFRAME_CLIPE)).toBe(false)
    expect(hostPermitido(null, DOMINIOS_IFRAME_CLIPE)).toBe(false)
    expect(hostPermitido('https://allstar.gg/x', null)).toBe(false)
  })
})

describe('PlayerClipe', () => {
  it('Allstar: iframe com sandbox', () => {
    const { container } = render(<PlayerClipe clipUrl="https://allstar.gg/iframe?clip=1" viewerSteamId="765" titulo="ACE" />)
    const iframe = container.querySelector('iframe')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups')
    expect(iframe.getAttribute('src')).toBe('https://allstar.gg/iframe?clip=1&UID=765&location=melhoresClipes')
  })

  it('outro host: link, sem iframe', () => {
    const { container } = render(<PlayerClipe clipUrl="https://medal.tv/clip/1" viewerSteamId="765" />)
    expect(container.querySelector('iframe')).toBeNull()
    const link = screen.getByRole('link', { name: /abrir clipe/i })
    expect(link).toHaveAttribute('href', 'https://medal.tv/clip/1')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('URL perigosa: nem iframe nem link', () => {
    const { container } = render(<PlayerClipe clipUrl="javascript:alert(1)" viewerSteamId="765" />)
    expect(container.querySelector('iframe, a')).toBeNull()
  })
})
