# Custo 0028 — painel local da carteira persistida

**Status:** aprovado para implementação local  
**Data:** 31 de agosto de 2026  
**Spec:** [0021](../specs/0021-persisted-portfolio-dashboard.md)

## Decisão de custo

Este incremento reutiliza a API, o PostgreSQL local, o frontend React e a
autenticação já existentes. Não cria recurso Terraform, serviço gerenciado,
cache, fila, storage, workflow ou tráfego para fornecedor externo.

| Componente | Alteração | Custo mensal incremental |
|---|---|---:|
| API privada | projeção segura de campos já persistidos | R$ 0 |
| PostgreSQL local | nenhuma tabela, índice ou migração nova | R$ 0 |
| Frontend | cliente paginado e interface da carteira | R$ 0 |
| Cloud Run / Supabase / GCS | não ativados | R$ 0 |

## Limites do gate

- execução somente local, com dados sintéticos;
- nenhuma consulta a tribunal ou outra fonte externa;
- nenhum deploy, push ou criação de recurso cloud;
- sem pré-carregar timeline de todos os processos: eventos são buscados apenas
  quando a pessoa abre um processo;
- páginas de carteira e alertas são carregadas em paralelo após um único token,
  reduzindo latência sem aumentar o número de chamadas necessárias.

## Próxima reavaliação

Custos devem ser recalculados antes de ativar qualquer ambiente remoto, fonte
real, e-mail, armazenamento de documentos ou processamento periódico.
