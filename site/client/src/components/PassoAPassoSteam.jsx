// Passo a passo de como pegar os dois códigos Steam (autenticação de histórico + share
// code) — usado tanto em Minha Conta quanto no passo 2 do Tour. Só texto/instrução; o
// formulário de inputs continua em quem usa este componente.
export default function PassoAPassoSteam() {
  return (
    <div className="space-y-3 font-mono text-sm leading-relaxed text-texto-fraco">
      <p>
        Para o Resenha achar suas Partidas de matchmaking, cole seu código de autenticação de
        histórico e um share code de partida. Os dois ficam na mesma página da Steam:
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Clique no link abaixo — ele tenta abrir direto a página de códigos (pode pedir login
          se você não estiver logado no navegador):{' '}
          <a
            className="text-destaque underline"
            href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128"
            target="_blank"
            rel="noreferrer"
          >
            Steam → Ajuda → Compartilhar histórico de partidas
          </a>
          .
        </li>
        <li>
          Se cair na Central de Ajuda em vez de ir direto pra página de códigos: clique no
          produto <span className="text-texto">Counter-Strike 2</span> na lista de produtos
          recentes.
        </li>
        <li>
          Clique em <span className="text-texto">"Gerenciar meus códigos de autenticação"</span>{' '}
          (fica no fim da lista de opções, abaixo de "remover jogo da conta").
        </li>
        <li>
          A página mostra dois valores — copie{' '}
          <span className="text-texto">"Código de autenticação"</span> (o de histórico, formato{' '}
          <span className="text-texto">XXXX-XXXXX-XXXX</span>) no primeiro campo abaixo, e{' '}
          <span className="text-texto">"Seu token de partida mais recente"</span> (o share code,
          formato <span className="text-texto">CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx</span>) no
          segundo.
        </li>
      </ol>
      <p>
        A busca anda <span className="text-texto">pra frente</span> a partir do código
        informado — use o <span className="text-texto">"primeiro código de partilha"</span>{' '}
        dessa página da Steam pra puxar seu histórico inteiro, ou um código recente pra começar
        só das partidas novas.
      </p>
    </div>
  )
}
