# Spec 0001 — Cadastro local e busca de processos

Status: aceita para implementação inicial
Data: 2026-08-29

## Objetivo

Validar, com o menor risco possível, se uma pessoa consegue cadastrar no próprio navegador um alvo de consulta por nome, CPF ou CNPJ e obter publicações do Diário de Justiça Eletrônico Nacional (DJEN) agrupadas por número de processo CNJ.

Esta etapa valida a fonte e a experiência de consulta. Ela ainda não é um monitor permanente nem uma base nacional de processos.

## Escopo

- Cadastrar alvos dos tipos `nome`, `cpf` e `cnpj` no armazenamento local do navegador.
- Normalizar e validar os valores no cliente e novamente no servidor.
- Consultar exclusivamente a API pública oficial do DJEN.
- Agrupar publicações pelo número CNJ normalizado.
- Exibir tribunal, órgão, classe, quantidade e data da publicação mais recente quando esses campos existirem na fonte.
- Exibir um resumo em texto simples da publicação, decodificando entidades HTML sem renderizar HTML, e o link oficial fornecido pela fonte.
- Exibir, quando informados pelo DJEN, tipo de comunicação, meio, tipo de documento e número da comunicação em cada publicação.
- Permitir nova consulta manual de um alvo já cadastrado.
- Não persistir nome, CPF, CNPJ ou resultados no servidor nesta etapa.

## Fora do escopo

- Varredura integral das bases dos tribunais.
- Garantia de cobertura nacional ou de todos os processos de uma pessoa/empresa.
- Consulta processual individual em portais de tribunais.
- Enriquecimento pelo DataJud para uso comercial.
- Alertas agendados, filas, workflows ou histórico permanente.
- Cadastro multiusuário e autenticação no aplicativo.
- Exposição pública da API. Eventual implantação permanece privada no Cloud Run.

## Estratégias por tipo de alvo

| Tipo | Filtro enviado ao DJEN | Confiança | Limitação explícita |
|---|---|---|---|
| Nome | `nomeParte` | Média | Homônimos, grafias diferentes e processos sem publicação no DJEN podem faltar ou gerar falso positivo. |
| CPF | `texto`, em formato pontuado e somente dígitos | Experimental | O DJEN não oferece filtro próprio por CPF; só encontra publicações que contenham literalmente o documento. |
| CNPJ | `texto`, em formato pontuado e somente dígitos | Experimental | O DJEN não oferece filtro próprio por CNPJ; só encontra publicações que contenham literalmente o documento. |

CPF e CNPJ nunca devem ser apresentados como cobertura completa. O servidor deve devolver essa limitação junto ao resultado, e a interface deve mantê-la visível.

## Regras de validação

### Nome

- Normalizar Unicode com NFKC.
- Remover espaços nas extremidades e reduzir espaços internos repetidos.
- Aceitar de 5 a 200 caracteres.
- Exigir ao menos duas partes não vazias para reduzir consultas excessivamente amplas.

### CPF

- Aceitar entrada pontuada ou somente dígitos.
- Conservar somente 11 dígitos.
- Rejeitar sequência de dígitos repetidos.
- Validar os dois dígitos verificadores.
- Nunca registrar o valor completo em logs.

### CNPJ

- Aceitar entrada pontuada ou somente dígitos.
- Conservar somente 14 dígitos.
- Rejeitar sequência de dígitos repetidos.
- Validar os dois dígitos verificadores.
- Nunca registrar o valor completo em logs.

## Contrato mínimo da API

### `GET /health`

Retorna `200` e `{ "ok": true }` sem consultar dependências externas.

### `POST /api/searches`

Corpo:

```json
{
  "type": "name",
  "value": "Pessoa Exemplo da Silva"
}
```

Resposta de sucesso:

```json
{
  "target": {
    "id": "hash-estavel",
    "type": "name",
    "displayValue": "Pessoa Exemplo da Silva"
  },
  "source": {
    "id": "DJEN",
    "official": true,
    "strategy": "nomeParte",
    "confidence": "medium"
  },
  "summary": {
    "publications": 2,
    "processes": 1,
    "ungroupedPublications": 0,
    "truncated": false
  },
  "processes": [],
  "warnings": []
}
```

Erros de entrada retornam `400` com um código estável e mensagem segura. Falhas ou timeout do DJEN retornam `502`. Respostas não devem ser armazenadas em cache compartilhado.

## Agrupamento e proveniência

- O identificador de agrupamento é o número CNJ com 20 dígitos.
- Formatações diferentes do mesmo número devem cair no mesmo grupo.
- Publicações duplicadas devem ser removidas pelo identificador oficial; na ausência dele, por uma chave determinística dos campos essenciais.
- Nenhum campo ausente pode ser inventado.
- Cada processo deve manter a lista de publicações que originou o agregado.
- O tribunal exibido deve vir do registro da própria publicação.
- Dados de processos diferentes nunca podem ser mesclados por nome de parte ou semelhança textual.

## Privacidade e segurança

- Dados cadastrados permanecem no `localStorage` do navegador nesta etapa.
- O backend é stateless e não grava payloads ou respostas.
- Logs devem conter somente identificador de requisição, tipo de busca, duração, status e contagens.
- A API aceita JSON, limita o corpo a 16 KiB, aplica timeout no upstream e rejeita tipos de conteúdo inesperados.
- O resumo de publicação é convertido para texto simples; HTML do DJEN não é renderizado.
- Entidades HTML nomeadas, numéricas decimais e numéricas hexadecimais são convertidas para caracteres Unicode antes da remoção das tags. Conteúdo codificado mais de uma vez também não pode deixar tags visíveis nem executáveis.
- Links só são clicáveis quando usam `https`.
- O frontend não usa `dangerouslySetInnerHTML`.

## Critérios de aceitação

1. Um nome válido gera consulta com `nomeParte` e publicações retornadas são agrupadas exclusivamente por número CNJ.
2. CPF e CNPJ inválidos são rejeitados antes de qualquer chamada externa.
3. CPF/CNPJ válidos geram consultas de texto nas versões pontuada e sem pontuação, com deduplicação.
4. Um registro sem número CNJ é contabilizado como não agrupado e não é anexado a outro processo.
5. Resultados de dois números CNJ distintos nunca são combinados, mesmo contendo a mesma parte.
6. O valor completo de CPF/CNPJ não aparece na resposta; somente a forma mascarada.
7. A interface mantém o aviso de cobertura experimental visível para CPF/CNPJ.
8. Testes unitários da aplicação e do domínio atingem 100% de linhas, funções, declarações e ramos.
9. Build, lint, typecheck, testes, auditoria de dependências, validação do container e Terraform bloqueiam o CI quando falham.
10. O texto exibido não contém entidades HTML residuais comuns, códigos numéricos de caracteres nem tags que tenham chegado codificadas.
11. Tipo de comunicação, meio, tipo de documento e número da comunicação são exibidos somente quando a própria publicação do DJEN fornece esses campos; campos ausentes não são inventados.

## Evidência da primeira validação

A consulta real deve ser manual e controlada. A evidência registrada no repositório conterá somente contagens, tribunais e números de processo já públicos, sem salvar CPF/CNPJ, texto integral de publicação ou payload bruto.
