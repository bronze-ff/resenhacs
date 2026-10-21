import { afterEach, expect, it, vi } from 'vitest'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))
vi.mock('../App.jsx', () => ({ default: () => <p>Aplicativo montado</p> }))
vi.mock('../observabilidade/posthog.js', () => ({ iniciarPosthog: vi.fn() }))
vi.mock('../observabilidade/sentry.js', () => ({ iniciarSentry: vi.fn() }))

import { iniciarSentry } from '../observabilidade/sentry.js'
import { createRoot } from 'react-dom/client'

vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => ({ render: vi.fn() })) }))

afterEach(() => vi.restoreAllMocks())

it.each(['sem DSN', 'import rejeitado'])('monta a aplicação com Sentry %s', async (caso) => {
  vi.resetModules()
  if (caso === 'import rejeitado') iniciarSentry.mockRejectedValue(new Error('chunk indisponível'))
  else iniciarSentry.mockResolvedValue(undefined)
  document.body.innerHTML = '<div id="root"></div>'
  await expect(import('../main.jsx')).resolves.toBeDefined()
  expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'))
  expect(createRoot.mock.results.at(-1).value.render).toHaveBeenCalled()
})
