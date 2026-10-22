import { describe, expect, it, vi } from 'vitest'
import { iniciarPopup, renderizarHistorico } from '../popup/popup.js'
import { matchId } from './fakes.js'

function documento() {
  const elemento = (tag) => ({
    tag, textContent: '', children: [], hidden: false, disabled: false, attributes: {}, eventos: {},
    append(...filhos) { this.children.push(...filhos) },
    replaceChildren(...filhos) { this.children = filhos },
    setAttribute(nome, valor) { this.attributes[nome] = valor },
    addEventListener(nome, fn) { this.eventos[nome] = fn }, focus: vi.fn(),
  })
  const ids = Object.fromEntries(['conteudo', 'conexao', 'conectar', 'desconectar', 'feedback', 'historico', 'vazio', 'preparacao'].map((id) => [id, elemento(id)]))
  return { createElement: elemento, getElementById: (id) => ids[id], ids }
}

describe('popup', () => {
  it('mostra texto hostil como texto e cria link só para UUID validado', () => {
    const doc = documento()
    renderizarHistorico(doc, [
      { data: '2026-10-22T12:00:00Z', estado: '<img src=x onerror=alert(1)>', mensagem: '<script>hostil</script>', matchId },
      { data: 'invalida', estado: 'erro', mensagem: 'Sem Partida', matchId: 'javascript:alert(1)' },
    ])
    const [primeiro, segundo] = doc.ids.historico.children
    expect(primeiro.children.find((e) => e.tag === 'strong').textContent).toContain('<img')
    expect(primeiro.children.find((e) => e.tag === 'p').textContent).toBe('<script>hostil</script>')
    expect(primeiro.children.find((e) => e.tag === 'a')).toMatchObject({ href: `https://resenha-phi.vercel.app/partida/${matchId}`, rel: 'noopener noreferrer' })
    expect(segundo.children.some((e) => e.tag === 'a')).toBe(false)
  })

  it('abre marcando histórico como lido e desconecta sem deixar o token no popup', async () => {
    const doc = documento()
    const chrome = {
      runtime: { sendMessage: vi.fn().mockResolvedValueOnce({ conectada: true, historico: [], novos: 0 }).mockResolvedValueOnce({ conectada: false, historico: [], novos: 0 }) },
      storage: { onChanged: { addListener: vi.fn() } },
    }
    await iniciarPopup(doc, chrome)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'resenha-historico-lido' })
    expect(doc.ids.conexao.textContent).toBe('Conectada ao ResenhaCS')
    expect(doc.ids.conectar.hidden).toBe(true)
    expect(doc.ids.vazio.hidden).toBe(false)
    await doc.ids.desconectar.eventos.click()
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ tipo: 'resenha-desconectar' })
    expect(doc.ids.conexao.textContent).toBe('Conecte sua conta para enviar Demos')
    expect(doc.ids.conectar.focus).toHaveBeenCalled()
  })

  it('falha de conexão é visível e libera o estado de carregamento', async () => {
    const doc = documento()
    const chrome = { runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('privado')) }, storage: { onChanged: { addListener: vi.fn() } } }
    await iniciarPopup(doc, chrome)
    expect(doc.ids.feedback.hidden).toBe(false)
    expect(doc.ids.feedback.textContent).not.toContain('privado')
    expect(doc.ids.conteudo.attributes['aria-busy']).toBe('false')
  })
})
