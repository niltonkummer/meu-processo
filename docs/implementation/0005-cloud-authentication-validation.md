# Implementação 0005 — autenticação no Google Cloud

**Data:** 30 de agosto de 2026
**Estado:** autenticação e consulta validadas em revisão privada; rollout público
retido pelo critério do proxy de documentos
**Spec:** [Spec 0003](../specs/0003-authentication.md)
**Custo:** [Avaliação 0005](../costs/0005-public-authenticated-proxy.md)

## Entregue no projeto `meu-processo-507018`

- Identity Platform inicializado diretamente, sem depender do Firebase Console;
- e-mail/senha habilitado; anônimo, telefone e e-mail duplicado desabilitados;
- chave web restrita ao Cloud Run/localhost e somente à API Identity Toolkit;
- runtime `meu-processo-runtime` com o papel somente leitura
  `roles/firebaseauth.viewer`, necessário para verificar revogação;
- painel compilado com a configuração pública do SDK Firebase;
- token mantido em memória e todas as rotas `/api/` protegidas no backend;
- revisão imutável
  `app:a7f5c2ec7e9b4df0373f177dfbfc1f600415644d` publicada para Linux/AMD64 e
  aplicada na revisão `meu-processo-mvp-00027-8hq`;
- afinidade de sessão de melhor esforço habilitada para desafios efêmeros;
- Cloud Run ainda privado, sem binding `allUsers`.

## Evidência de validação privada

Uma conta sintética com e-mail confirmado foi criada pela API administrativa,
usada no smoke e removida ao final. A partir do runtime em
`southamerica-east1`:

- login web no Identity Toolkit: sucesso;
- `GET /api/v1/session`: HTTP 200;
- busca autenticada pelo nome de validação: HTTP 200, 16 publicações agrupadas
  em 3 processos;
- resposta sem URLs oficiais e com dados processuais agrupados por CNJ;
- `referrer-policy: strict-origin-when-cross-origin`, necessária para aplicar a
  restrição de domínio da chave sem transmitir caminho/query;
- chamada sem Google IAM continua sem alcançar o serviço enquanto privado.

Gates finais: 156 testes, cobertura de 100% em statements/branches/functions/
lines, lint, tipos e build aprovados; Terraform com 3 testes nativos; Checkov
com 9 controles aprovados e 0 falhas; imagem com 0 vulnerabilidades High/
Critical e 0 segredos; Infracost com US$ 0,02/mês de custo-base; plano remoto
final sem drift.

## Critério que reteve o rollout público

O TJRS respondeu ao link do DJEN com HTML e cookie de sessão. A telemetria
estrutural, sem URL, HTML, nomes ou valores de campos, confirmou um único
formulário POST no mesmo host, cinco campos ocultos e um campo de texto vazio.
O fluxo assistido aceita somente raster validado e vinculado ao mesmo usuário e
publicação. No teste real, a única imagem embutida era um ícone de áudio PNG
24×24; a única referência estática relacionada ao CAPTCHA respondeu HTTP 404
com HTML. A imagem do código depende da interação JavaScript da página. O
resultado real permanece HTTP 502 por política. Nenhum JavaScript, CAPTCHA ou
sessão judicial foi automatizado ou compartilhado.

Conforme a Spec 0004 e a avaliação de custo, o binding público só poderá ser
aplicado quando um PDF real passar do runtime brasileiro ou quando uma nova spec
aprovar outra estratégia de documentos. O frontend e a API permanecem privados
até essa decisão; a consulta autenticada e a abertura do detalhe do processo já
estão validadas na revisão privada.
