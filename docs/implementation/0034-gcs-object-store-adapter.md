# Implementação 0034 — adapter GCS tenant-private

**Status:** implementada e verificada localmente  
**Data:** 31 de agosto de 2026  
**Spec:** [0030](../specs/0030-gcs-object-store-adapter.md)  
**Custo:** [0037](../costs/0037-gcs-object-store-adapter.md)

## Resultado

- `GcsObjectStore` implementa os contratos de download privado,
  materialização e lifecycle;
- `GoogleCloudStorageGateway` encapsula o SDK oficial 8.0.1 e não deixa erros do
  provider cruzarem a fronteira;
- uploads são create-only, com CRC32C, precondition e SHA-256;
- leituras e deleções são generation-pinned;
- conflito de retry exige validação integral do objeto existente;
- API, materializador e lifecycle possuem modos GCS explícitos e fail-closed;
- modo local e Compose não foram alterados;
- IAM do materializador ganhou leitura de verificação sem delete/overwrite.

Não existe chamada ao GCS nos testes. O gateway recebe doubles estruturais; o
SDK real só será autenticado por ADC quando um workload GCP explicitamente
ativado selecionar o modo GCS.

## Evidência

- 79 arquivos e 983 testes aprovados;
- cobertura protegida: 1.904 statements, 1.479 branches, 380 funções e 1.745
  linhas — 100% em todas as métricas;
- lint e typecheck aprovados;
- Terraform fmt/validate e cinco testes nativos aprovados;
- `npm audit --audit-level=high` aprovado; nove findings moderados transitivos
  permanecem no tooling Firebase e não foram elevados por este adapter;
- nenhum recurso, objeto, credencial, commit, push ou deploy criado.

## Próximo gate

1. preparar avaliação de rollout sandbox e Infracost real;
2. validar Supabase/Supavisor e aplicar migrations com dados sintéticos;
3. aplicar a fundação passiva aprovada;
4. configurar Secret Sync Infisical → Secret Manager sem deleção remota;
5. publicar revisão Cloud Run com modos GCS, executar smoke e rollback;
6. medir operações, bytes, egress, latência e erros por sete dias.

