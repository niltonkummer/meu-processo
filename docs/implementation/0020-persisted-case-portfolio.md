# Implementação 0020 — carteira processual persistida

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0023](../costs/0023-local-persisted-case-portfolio.md)  
**Spec:** [0016](../specs/0016-persisted-case-portfolio.md)  
**Arquitetura:** [ADR 0012](../adr/0012-tenant-control-and-evidence-planes.md)

## Resultado

`GET /api/v1/cases` agora pode listar os processos já persistidos para o tenant
pessoal autenticado. A leitura usa cursor estável, limite máximo de 100 itens e
proveniência mínima da fonte. Nenhuma chamada a tribunal é feita durante a
listagem e o runtime não recebe acesso direto às tabelas de evidência.

A mesma porta de aplicação possui adapters em memória e PostgreSQL. O adapter
real resolve o usuário pelo subject do token, define usuário/tenant somente para
a transação e chama uma função estreita que revalida membership ativa. A função
deriva o tenant da sessão: o cliente não consegue escolher outro tenant por
parâmetro.

## Contrato entregue

- paginação `limit`/`after` com validação estrita e `limit + 1` no banco;
- ordenação crescente por UUID interno do processo;
- resposta limitada a ID interno, CNJ, tribunal, estado de identidade, última
  projeção e fonte mínima;
- lista vazia para tenant pessoal novo e autorizado;
- HTTP 401 para autenticação ausente, 403 para vínculo negado e 400 para página
  inválida;
- contexto de organização sem implementação persistida falha fechado;
- `Cache-Control: private, no-store` nas respostas privadas.

Detalhe, linha do tempo, publicações, documentos, filtros e organizações não
foram implicitamente simulados: continuam fora desta fatia.

## Segurança e dados

- `app_runtime` possui `EXECUTE` somente na projeção de leitura;
- `app_runtime`, `app_worker` e `PUBLIC` não possuem `SELECT` direto nas tabelas
  de evidência;
- RLS continua habilitada e forçada, com ownership separado;
- mesmo CNJ em tenants diferentes foi exercitado sem vazamento;
- URL, texto, nome, CPF/CNPJ, participante, payload e documento não entram na
  resposta;
- fonte oficial/sintética é classificada no cadastro da fonte e não inferida no
  frontend.

## Evidência de validação

- 451 testes de aplicação/UI em 42 arquivos, com 100% de statements, branches,
  functions e lines no núcleo monitorado;
- 107 asserts pgTAP em 4 arquivos;
- 15 contracts PostgreSQL em 3 arquivos;
- banco recriado do zero, worker one-shot sem fonte real e restore lógico
  aprovados;
- lint, tipos, build, Compose, Actionlint, ShellCheck, Hadolint e `git diff
  --check` aprovados;
- scan de segredos sem achados e imagem final com zero vulnerabilidades
  HIGH/CRITICAL;
- auditoria de dependências sem high/critical; permanecem nove findings
  moderados transitivos já conhecidos na cadeia de ferramentas Firebase;
- nenhuma fonte externa, Supabase, GCP, Infisical ou Brevo foi acessada;
- custo adicional de fornecedor: US$ 0.

## Próximo gate

Detalhe e linha do tempo persistidos exigem uma nova projeção tenant-scoped,
política de retenção e threat model confirmado para a fronteira de evidência.
Antes de ligar fonte real também faltam catálogo/termos por tribunal, dados
oficiais de teste autorizados, configuração de vault e rollout privado. Cache ou
mecanismo de busca só entra após uma medição que demonstre necessidade.
