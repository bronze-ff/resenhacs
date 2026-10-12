import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { limparEventoPosthog } from '../observabilidade/posthog.js'

const URL = 'https://resenha-phi.vercel.app/partida/abc?token=segredo&x=1#frag'
const LIMPA = 'https://resenha-phi.vercel.app/partida/abc'

describe('evento do PostHog', () => {
  it('tira query e fragment de URL, pathname, referrer e campos $initial_ / $prev_pageview_', () => {
    const evento = limparEventoPosthog({
      event: '$pageview',
      properties: {
        $current_url: URL,
        $pathname: '/partida/abc?token=segredo#frag',
        $referrer: 'https://google.com/search?q=resenha#top',
        $initial_current_url: URL,
        $initial_pathname: '/feed?code=1',
        $prev_pageview_pathname: '/ranking?page=2#tabela',
        $prev_pageview_last_current_url: URL,
        link: 'https://resenhacs.vercel.app/api/auth/me?code=1',
        mapa: 'de_dust2',
      },
    })
    expect(evento.properties).toEqual({
      $current_url: LIMPA,
      $pathname: '/partida/abc',
      $referrer: 'https://google.com/search',
      $initial_current_url: LIMPA,
      $initial_pathname: '/feed',
      $prev_pageview_pathname: '/ranking',
      $prev_pageview_last_current_url: LIMPA,
      link: 'https://resenhacs.vercel.app/api/auth/me',
      mapa: 'de_dust2',
    })
  })

  it('não reescreve campo de transporte e apaga ip, identify extra e apelido', () => {
    const evento = limparEventoPosthog({
      uuid: 'token?nao-mexer#1',
      event: '$pageview',
      timestamp: '2026-10-12T00:00:00Z',
      properties: {
        distinct_id: '76561198000000000?x=1',
        $session_id: 'sessao?q=1#f',
        token: 'https://evil.test/a?b=1#c',
        $lib: 'web',
        email: 'a@b.com',
        nick: 'jogador',
        avatarUrl: 'https://cdn.example/a.png?sig=1',
        faceitNick: 'nick',
        $ip: '1.2.3.4',
        $set: { email: 'a@b.com' },
        $current_url: URL,
      },
    })
    expect(evento.uuid).toBe('token?nao-mexer#1')
    expect(evento.event).toBe('$pageview')
    expect(evento.timestamp).toBe('2026-10-12T00:00:00Z')
    expect(evento.properties.distinct_id).toBe('76561198000000000?x=1')
    expect(evento.properties.$session_id).toBe('sessao?q=1#f')
    expect(evento.properties.token).toBe('https://evil.test/a?b=1#c')
    expect(evento.properties.$lib).toBe('web')
    expect(evento.properties.$current_url).toBe(LIMPA)
    expect(evento.properties.email).toBeUndefined()
    expect(evento.properties.nick).toBeUndefined()
    expect(evento.properties.avatarUrl).toBeUndefined()
    expect(evento.properties.faceitNick).toBeUndefined()
    expect(evento.properties.$ip).toBeUndefined()
    expect(evento.properties.$set).toBeUndefined()
  })

  it('remove atribuição de campanha, inclusive a cópia em $set e $set_once', () => {
    const evento = limparEventoPosthog({
      event: '$pageview',
      properties: {
        $utm_source: 'newsletter',
        $utm_medium: 'email',
        $utm_campaign: 'onda',
        $utm_content: 'a',
        $utm_term: 'cs',
        utm_source: 'newsletter',
        utm_medium: 'cpc',
        $initial_utm_source: 'newsletter?token=1',
        $initial_utm_medium: 'email',
        $initial_utm_campaign: 'onda',
        $gclid: 'g1',
        gclid: 'g2',
        fbclid: 'f1',
        $fbclid: 'f2',
        msclkid: 'm1',
        $msclkid: 'm2',
        $session_entry_url: URL,
        $session_entry_referrer: 'https://google.com/search?q=1',
        $session_entry_referring_domain: 'google.com',
        $session_entry_host: 'resenha-phi.vercel.app',
        $initial_referrer: 'https://t.co/x?utm=1#y',
        $initial_referring_domain: 't.co',
        $referring_domain: 'google.com',
        $referrer: 'https://google.com/search?q=resenha#top',
        $current_url: URL,
        mapa: 'de_dust2',
        $set: {
          $utm_source: 'newsletter',
          utm_campaign: 'onda',
          $gclid: 'g1',
          fbclid: 'f1',
          msclkid: 'm1',
          $initial_utm_source: 'ads',
          $initial_referrer: 'https://t.co/x',
          $initial_referring_domain: 't.co',
          $referring_domain: 'google.com',
          $session_entry_url: URL,
          email: 'a@b.com',
        },
        $set_once: {
          $initial_utm_source: 'ads',
          $initial_utm_campaign: 'onda',
          gclid: 'g2',
          $fbclid: 'f2',
          $msclkid: 'm2',
          $session_entry_host: 'resenha-phi.vercel.app',
          $initial_referring_domain: 't.co',
        },
      },
    })
    expect(evento.properties).toEqual({
      $referrer: 'https://google.com/search',
      $current_url: LIMPA,
      mapa: 'de_dust2',
    })
  })

  it('before_send usa o limpador e a chave é lida de forma estática', () => {
    const fonte = readFileSync(join(process.cwd(), 'src/observabilidade/posthog.js'), 'utf8')
    expect(fonte).toMatch(/before_send: limparEventoPosthog/)
    expect(fonte).toMatch(/import\.meta\.env\.VITE_POSTHOG_KEY/)
    expect(fonte).not.toMatch(/import\.meta\.env\[/)
  })
})
