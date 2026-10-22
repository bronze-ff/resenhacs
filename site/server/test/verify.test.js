import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const argvOriginal = process.argv
const plataformaOriginal = process.platform

beforeEach(() => {
  vi.resetModules()
  spawnSync.mockReset().mockReturnValue({ status: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation((codigo) => { throw new Error(`exit ${codigo}`) })
})

afterEach(() => {
  process.argv = argvOriginal
  Object.defineProperty(process, 'platform', { value: plataformaOriginal })
  vi.restoreAllMocks()
})

describe('verify', () => {
  it.each(['win32', 'linux'])('executa npm com shell somente no Windows (%s)', async (platform) => {
    Object.defineProperty(process, 'platform', { value: platform })
    process.argv = ['node', 'verify.mjs', 'server']
    await import('../../../scripts/verify.mjs')
    expect(spawnSync).toHaveBeenCalledWith('npm', ['test'], expect.objectContaining({
      shell: platform === 'win32',
      stdio: 'inherit',
    }))
  })

  it('rejeita parte desconhecida antes de executar comandos', async () => {
    process.argv = ['node', 'verify.mjs', 'server', 'inexistente']
    await expect(import('../../../scripts/verify.mjs')).rejects.toThrow('exit 1')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('inexistente'))
    expect(spawnSync).not.toHaveBeenCalled()
  })
})
