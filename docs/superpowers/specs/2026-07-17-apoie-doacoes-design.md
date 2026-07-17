# Apoie (doações) — Design

## Contexto

O Resenha é mantido pelo Filippe pro grupo fechado de amigos, com custo real de infra
(Vercel/Supabase/R2). Ele quer uma forma discreta de deixar aberto pra quem quiser ajudar a
cobrir esse custo, via PIX, sem cobrar ninguém nem exigir nada.

## Escopo

Uma página nova (`/apoie`), acessível por um item no menu principal, mostrando:
- Mensagem curta convidando a ajudar a manter o sistema no ar (sem expor valores de custo).
- A chave PIX como texto copiável (botão "copiar").
- Um QR code PIX gerado a partir da mesma chave, pra quem preferir escanear.

As duas formas (copiar-e-colar e QR code) ficam sempre visíveis juntas — o usuário escolhe
qual usar, não é uma escolha alternável na interface.

Fora de escopo: rastreio de quem doou, confirmação de pagamento, valor sugerido/fixo,
transparência de custos (valores de infra não aparecem na página), qualquer conta ou webhook
de pagamento.

## Dados do PIX

- **Chave (aleatória):** `98dea706-4b3d-4ae4-b96d-e96a6669bb8a`
- **Nome do recebedor:** `Filippe Faria`
- **Cidade:** `Aparecida de Goiania`

Não são dados sensíveis — uma chave PIX é feita pra ser divulgada publicamente (equivalente a
um número de conta pra receber, não permite saque/movimentação). Ficam como constantes no
código do client (`site/client/src/lib/pix.js`), sem variável de ambiente — são só 3 strings
estáticas, trocar exigiria uma edição de código de qualquer forma se o Filippe mudar de chave,
e isso é raro o suficiente pra não justificar a indireção de um env var.

## Arquitetura

100% client-side. Sem rota nova no server, sem tabela no banco, sem chamada de API.

- **`site/client/src/lib/pix.js`** (novo) — função pura `montarPayloadPix({ chave, nome,
  cidade })` que monta o payload EMV/BR Code do Bacen (Merchant Account Info com GUI
  `BR.GOV.BCB.PIX` em maiúsculas + chave, Merchant Category Code `0000`, moeda `986` (BRL),
  país `BR`, Merchant Name e Merchant City convertidos pra maiúsculas e truncados em 25 e 15
  caracteres respectivamente — convenção do padrão; os valores originais em `Apoie.jsx`
  continuam com capitalização normal, a conversão é só dentro do payload do QR — valor de
  transação em aberto — sem campo de valor, deixando o pagador decidir quanto doar — e
  CRC16-CCITT-FALSE (polinômio `0x1021`, valor inicial `0xFFFF`, sem reflexão, sem XOR final)
  no final, como exige o padrão). Retorna a string do payload (o "PIX copia e cola").
- **`site/client/src/pages/Apoie.jsx`** (novo) — a página: mensagem, botão "copiar" (usa
  `navigator.clipboard.writeText` sobre o payload), e o QR code renderizado a partir do mesmo
  payload via biblioteca `qrcode` (rendering em `<canvas>` ou `<img>` a partir de
  `QRCode.toDataURL`).
- **Nova dependência:** `qrcode` (client, só gera a imagem a partir de uma string — não faz
  chamada de rede, tudo local).
- **`site/client/src/components/Shell.jsx`** — novo item de menu "Apoie", visível pra
  qualquer membro logado, mesmo padrão dos itens existentes.
- **Rotas do client** (onde as demais páginas internas são declaradas) — rota nova `/apoie`,
  protegida do mesmo jeito que as outras páginas internas (exige sessão).

## Erros

Não há estado assíncrono nem chamada externa — nada que possa falhar em runtime. Único
possível "erro" é `navigator.clipboard` indisponível (contexto não-HTTPS ou navegador muito
antigo) — nesse caso o botão "copiar" simplesmente não faz nada; como o texto do payload já
fica visível na página pra seleção manual, não é necessário tratamento adicional.

## Testes

- `pix.test.js` (novo): `montarPayloadPix({ chave: '98dea706-4b3d-4ae4-b96d-e96a6669bb8a',
  nome: 'Filippe Faria', cidade: 'Aparecida de Goiania' })` deve retornar exatamente:

  ```
  00020101021126580014BR.GOV.BCB.PIX013698dea706-4b3d-4ae4-b96d-e96a6669bb8a5204000053039865802BR5913FILIPPE FARIA6015APARECIDA DE GO62070503***63047D11
  ```

  Esse valor foi calculado e verificado nesta sessão (payload EMV/BR Code montado campo a
  campo — GUI `BR.GOV.BCB.PIX` em maiúsculas, conforme o Manual do BR Code do Bacen; nome e
  cidade em maiúsculas; CRC16-CCITT-FALSE computado sobre a string real via script Python),
  não é um placeholder. Cobre truncamento de nome (25) e cidade (15 — "APARECIDA DE GOIANIA",
  20 caracteres, vira "APARECIDA DE GO") e o CRC16 correto.
- Smoke test de `Apoie.jsx` (mesmo padrão dos outros smoke tests do projeto): renderiza sem
  crashar, mostra a chave PIX como texto, o botão "copiar" existe, e existe um elemento de QR
  code (imagem ou canvas) na página.
