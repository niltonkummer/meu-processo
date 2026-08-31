# Custo 0029 — catálogo persistido de documentos

**Status:** aprovado para implementação local  
**Data:** 31 de agosto de 2026  
**Spec:** [0022](../specs/0022-persisted-document-catalog.md)

## Decisão de custo

Este incremento persiste somente metadados e o estado de materialização do
arquivo no PostgreSQL local. Ele reutiliza API, autenticação e frontend já
existentes e não cria bucket, objeto, fila, job ou tráfego externo.

| Componente | Alteração local | Custo mensal incremental |
|---|---|---:|
| PostgreSQL | duas tabelas, índices e consulta tenant-scoped | R$ 0 |
| API e frontend | catálogo paginado e vínculo à timeline | R$ 0 |
| Cloud Storage | contrato preparado, sem bucket/objetos | R$ 0 |
| Cloud Tasks / Cloud Run Jobs | não ativados | R$ 0 |

## Referência para o futuro gate remoto

Valores em USD, consultados na tabela oficial do Google Cloud em 31 de agosto
de 2026 e sujeitos à região, câmbio, impostos e alterações do fornecedor:

- Standard Storage regional em São Paulo: aproximadamente **US$ 0,022 por
  GiB-mês** (`US$ 0,000030137/GiB-hora × 730 horas`);
- operações Standard regionais: **US$ 0,005/1.000 Class A** e
  **US$ 0,0004/1.000 Class B**;
- Cloud Tasks: primeiro milhão de operações mensais sem cobrança e, depois,
  **US$ 0,40 por milhão**; tentativas e payloads acima de 32 KiB contam;
- Cloud Run Jobs cobra toda a vida da instância com mínimo de um minuto e São
  Paulo usa a faixa regional Tier 2.

Para `N` arquivos com tamanho médio `M MiB` e retenção média `D dias`, a
ocupação média aproximada é `N × M × D / (1024 × 30) GiB-mês`. Exemplo de
limite de validação, sem prometer fatura: 10.000 PDFs de 2 MiB retidos por 24
horas representam cerca de 0,651 GiB-mês, ou aproximadamente US$ 0,014 apenas
de armazenamento. Download, operações, CPU e saída de rede são parcelas
separadas e precisam de medição real.

Fontes oficiais:

- https://cloud.google.com/storage/pricing
- https://cloud.google.com/tasks/pricing
- https://cloud.google.com/run/pricing

## Limites do gate

- somente dados sintéticos e execução local;
- nenhum byte de documento será persistido no PostgreSQL;
- `storage_object_id` permanece interno e nunca entra na API;
- um artefato só é apresentável como disponível após hash, tamanho, tipo,
  expiração e estado de malware válidos;
- download individual, criação do bucket e exportação em lote permanecem
  desabilitados até novo orçamento e autorização explícita.

## Próxima reavaliação

Antes de ativar GCS serão obrigatórios: estimativa por volume e retenção,
lifecycle, Public Access Prevention, IAM mínimo, limite orçamentário, alerta de
consumo e teste de remoção. Cloud Tasks e Cloud Run Jobs só entram no orçamento
quando o download individual concluir o gate controlado da Fase 2.
