import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Card, SectionHeader, StatTile, Badge, RatingBadge, DataTable, PremierBadge, PlataformaBadge, FaceitEloBadge } from '../components/ui/index.js'

// Teste de fumaça: cada primitivo renderiza sem crashar e mostra seu conteúdo essencial.
describe('primitivos de UI', () => {
  it('Card renderiza children e variante interativa', () => {
    const { getByText } = render(<Card interativo>conteúdo</Card>)
    expect(getByText('conteúdo')).toBeInTheDocument()
  })

  it('SectionHeader mostra título e ação', () => {
    const { getByText } = render(<SectionHeader titulo="Estatísticas" acao={<a href="#">ver todos</a>} />)
    expect(getByText('Estatísticas')).toBeInTheDocument()
    expect(getByText('ver todos')).toBeInTheDocument()
  })

  it('StatTile mostra rótulo, valor e sub', () => {
    const { getByText } = render(<StatTile rotulo="Rating" valor="1.14" sub="acima" tom="sucesso" />)
    expect(getByText('Rating')).toBeInTheDocument()
    expect(getByText('1.14')).toBeInTheDocument()
    expect(getByText('acima')).toBeInTheDocument()
  })

  it('Badge renderiza cada tom', () => {
    const { getByText } = render(
      <>
        <Badge tom="destaque">PRO</Badge>
        <Badge tom="sucesso">Vitória</Badge>
        <Badge tom="perigo">Derrota</Badge>
        <Badge tom="neutro">AUTO</Badge>
      </>,
    )
    expect(getByText('PRO')).toBeInTheDocument()
    expect(getByText('Derrota')).toBeInTheDocument()
  })

  it('RatingBadge formata 2 casas e trata nulo', () => {
    const { getByText } = render(
      <>
        <RatingBadge valor={1.2} />
        <RatingBadge valor={0.85} />
        <RatingBadge valor={null} />
      </>,
    )
    expect(getByText('1.20')).toBeInTheDocument()
    expect(getByText('0.85')).toBeInTheDocument()
    expect(getByText('–')).toBeInTheDocument()
  })

  it('DataTable renderiza thead e linhas', () => {
    const { getByText } = render(
      <DataTable head={<tr><th>Nick</th></tr>}>
        <tr><td>fih</td></tr>
      </DataTable>,
    )
    expect(getByText('Nick')).toBeInTheDocument()
    expect(getByText('fih')).toBeInTheDocument()
  })

  it('PlataformaBadge mostra PREMIER/FACEIT com logo e nada pra outros sources', () => {
    const { getByText, container } = render(<PlataformaBadge source="valve_mm" />)
    expect(getByText('PREMIER')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
    const { getByText: getFaceit } = render(<PlataformaBadge source="faceit" />)
    expect(getFaceit('FACEIT')).toBeInTheDocument()
    const { container: vazio } = render(<PlataformaBadge source="upload" />)
    expect(vazio.firstChild).toBeNull()
  })

  it('PremierBadge mostra o valor e não renderiza nada quando null', () => {
    const { getByText } = render(<PremierBadge valor={5200} />)
    expect(getByText('5200')).toBeInTheDocument()
    const { container: vazio } = render(<PremierBadge valor={null} />)
    expect(vazio.firstChild).toBeNull()
  })

  it('FaceitEloBadge mostra elo+level e não renderiza nada quando null', () => {
    const { getByText, container } = render(<FaceitEloBadge elo={1425} level={7} />)
    expect(getByText('1425')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
    const { container: vazio } = render(<FaceitEloBadge elo={null} level={null} />)
    expect(vazio.firstChild).toBeNull()
  })
})
