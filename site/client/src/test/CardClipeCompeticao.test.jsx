import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CardClipeCompeticao, { partesDaPontuacao, rotuloDaJogada } from '../components/CardClipeCompeticao.jsx'

const CLIPE = {
  id: 'c1', map: 'de_inferno', playedAt: '2026-07-25T03:37:00Z', roundNumber: 18,
  kind: 'clutch_1v3', clipUrl: 'https://allstar.gg/c1', clipSnapshotUrl: 'https://allstar/c1.jpg',
  pontuacao: { kills: 3, pontosKills: 50, headshots: 2, pontosHeadshots: 16, armas: 2, pontosArmas: 10, clutch: '1v3', pontosClutch: 35, total: 111 },
  nick: 'bronze', avatarUrl: 'https://avatar/bronze.jpg',
}

describe('partesDaPontuacao', () => {
  it('so inclui o que somou', () => {
    expect(partesDaPontuacao({ kills: 2, pontosKills: 25, headshots: 0, armas: 1, pontosArmas: 5, clutch: null, total: 30 }))
      .toEqual(['2 kills 25', '1 armas 5'])
  })

  it('aguenta a forma reduzida { total }', () => {
    expect(partesDaPontuacao({ total: 30 })).toEqual([])
  })
})

describe('rotuloDaJogada', () => {
  it('usa o kind quando existe', () => {
    expect(rotuloDaJogada(CLIPE)).toBe('CLUTCH 1v3')
  })

  it('sem kind, cai pro numero de kills', () => {
    expect(rotuloDaJogada({ kind: null, pontuacao: { kills: 3 } })).toBe('3 KILLS')
  })

  it('sem kind e sem kills, MOMENTO', () => {
    expect(rotuloDaJogada({ kind: null, pontuacao: { total: 0 } })).toBe('MOMENTO')
  })
})

describe('CardClipeCompeticao', () => {
  it('mostra jogada, contexto e breakdown', () => {
    render(<CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={() => {}} />)
    expect(screen.getByText('CLUTCH 1v3')).toBeInTheDocument()
    expect(screen.getByText(/Inferno/)).toBeInTheDocument()
    expect(screen.getByText(/round 18/)).toBeInTheDocument()
    expect(screen.getByText('111')).toBeInTheDocument()
    expect(screen.getByText(/3 kills 50/)).toBeInTheDocument()
  })

  it('com autor, mostra nick e avatar de quem enviou', () => {
    const { container } = render(<CardClipeCompeticao clipe={CLIPE} autor aberto={false} onAbrir={() => {}} />)
    expect(screen.getByText('bronze')).toBeInTheDocument()
    // duas <img> no card (avatar e snapshot), as duas com alt="" por serem
    // decorativas — localiza pelo src, não por alt.
    const fontes = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(fontes).toContain('https://avatar/bronze.jpg')
  })

  it('sem autor, nao mostra o nick', () => {
    render(<CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={() => {}} />)
    expect(screen.queryByText('bronze')).toBeNull()
  })

  it('renderiza a acao quando recebe, e nada quando nao', () => {
    const { rerender } = render(
      <CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={() => {}} acao={<button>enviar</button>} />,
    )
    expect(screen.getByRole('button', { name: 'enviar' })).toBeInTheDocument()
    rerender(<CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={() => {}} />)
    expect(screen.queryByRole('button', { name: 'enviar' })).toBeNull()
  })

  it('clicar no thumbnail pede pra abrir; clicar em fechar pede pra fechar', () => {
    const onAbrir = vi.fn()
    const { rerender } = render(<CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={onAbrir} />)
    fireEvent.click(screen.getByRole('button', { name: /assistir/i }))
    expect(onAbrir).toHaveBeenCalledWith('c1')

    rerender(<CardClipeCompeticao clipe={CLIPE} aberto onAbrir={onAbrir} />)
    expect(document.querySelector('iframe')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /fechar/i }))
    expect(onAbrir).toHaveBeenCalledWith(null)
  })
})
