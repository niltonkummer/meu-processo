# Spec 0028 — controles de dados da conta

**Status:** aprovada para implementação local/CI  
**Custo:** avaliação 0035, delta US$ 0

## Objetivo

Permitir que uma pessoa autenticada solicite e acompanhe uma exportação dos
dados de sua conta, baixe o JSON concluído e solicite a exclusão da conta sem
risco de enumeração ou mistura entre tenants.

## Contratos funcionais

- `POST /api/v1/account/data-exports` cria ou reutiliza a exportação aberta e
  responde `202`.
- `GET /api/v1/account/data-exports/{requestId}` retorna estado e metadados
  públicos; locator e hash internos nunca aparecem.
- `GET /api/v1/account/data-exports/{requestId}/download` entrega somente uma
  exportação `completed`, íntegra e não expirada como anexo JSON privado.
- `POST /api/v1/account/deletion-requests` aceita apenas o objeto exato
  `{ "confirmation": "EXCLUIR MINHA CONTA" }`, token autenticado há no máximo
  cinco minutos e tenant pessoal; responde `202` e a UI encerra a sessão.
- solicitações pendentes são processadas exclusivamente pelo worker one-shot;
  nenhuma rota pública dispara trabalho privilegiado.

## Estados e mensagens

`pending`, `running`, `completed`, `failed` e `expired` são exibidos em
português. O painel diferencia “preparando”, “pronto para baixar”, “falhou” e
“expirou”, sem prometer processamento imediato. Falhas retornam mensagens
genéricas e um código estável.

## Segurança e privacidade

- Bearer token somente em memória; autorização sempre no servidor.
- tenant é derivado da identidade; `requestId` de outro tenant resulta 404.
- download exige estado concluído, TTL válido e validação de tamanho/SHA-256.
- resposta usa `Content-Disposition: attachment`, `application/json`,
  `X-Content-Type-Options: nosniff` e `Cache-Control: private, no-store`.
- sem HTML bruto, armazenamento do navegador, URL externa ou locator privado.
- exclusão é pessoal, irreversível, confirmada e protegida por autenticação
  recente; operações organizacionais ficam fora desta fatia.

## Aceitação

1. tenant A não consulta nem baixa solicitação de B, inclusive conhecendo o ID;
2. arquivo adulterado, expirado ou ausente nunca é entregue;
3. token sem `auth_time` ou mais antigo que cinco minutos não exclui a conta;
4. confirmação divergente, chaves extras e media type incorreto são rejeitados;
5. a UI mantém token e senha apenas em memória, anuncia estados e limpa a senha;
6. unitários, cobertura total, pgTAP, contratos de banco, OpenAPI, Compose e
   scanners existentes permanecem verdes.
