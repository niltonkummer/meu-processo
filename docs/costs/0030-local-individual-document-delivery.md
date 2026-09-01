# Custo 0030 — entrega individual local de documentos

**Status:** aprovado para implementação local  
**Data:** 31 de agosto de 2026  
**Spec:** [0023](../specs/0023-individual-document-delivery.md)

## Decisão de custo

O incremento usa somente PostgreSQL e um diretório privado local com PDFs
sintéticos. Não cria bucket, objeto remoto, fila, job, workflow, scanner pago ou
tráfego para fornecedor. O custo mensal incremental desta implementação é
**R$ 0**.

| Componente | Alteração neste gate | Custo incremental |
|---|---|---:|
| PostgreSQL local | janela de quota e auditoria de autorização/resultado | R$ 0 |
| API/frontend local | entrega autenticada de um PDF por vez | R$ 0 |
| Object storage local | diretório explicitamente configurado, fora do web root | R$ 0 |
| GCS, Cloud Tasks, Jobs e Workflows | não ativados | R$ 0 |

## Teto operacional local

- máximo de 20 autorizações por minuto, usuário e tenant;
- máximo de 25 MiB por arquivo entregue neste MVP;
- no máximo um objeto em memória por requisição;
- somente PDF sintético com tamanho, assinatura e SHA-256 conferidos;
- falha de storage também consome a janela antiabuso e fica auditada;
- sem retenção nova: o adapter lê um arquivo previamente preparado.

## Referência do futuro gate GCS

Preços oficiais consultados em 31 de agosto de 2026, em USD e sujeitos a região,
câmbio, impostos e alteração do fornecedor:

- Standard Storage regional em São Paulo: aproximadamente **US$ 0,022/GiB-mês**
  (`US$ 0,000030137/GiB-hora × 730`);
- operações Standard em região: **US$ 0,005/1.000 Class A** e
  **US$ 0,0004/1.000 Class B**;
- storage, operações e transferência de dados são cobrados separadamente.

Exemplo conservador: 10.000 PDFs de 2 MiB retidos por 24 horas ocupam em média
0,651 GiB-mês, aproximadamente US$ 0,014 de armazenamento, sem incluir
operações, CPU, logs ou saída de rede. O custo real deve ser medido por bytes
armazenados/entregues e por retenção, não pelo número de processos.

Fontes oficiais:

- https://cloud.google.com/storage/pricing
- https://docs.cloud.google.com/storage/docs/public-access-prevention
- https://docs.cloud.google.com/storage/docs/access-control/iam

## Condições para ativar GCS

GCS continua bloqueado até autorização explícita e uma nova avaliação contendo:

1. bucket regional privado em `southamerica-east1` por Terraform;
2. Uniform Bucket-Level Access e Public Access Prevention `enforced`;
3. lifecycle e teste de remoção/expiração;
4. service account de leitura restrita ao bucket, sem chave persistente;
5. orçamento, alertas e kill switch server-side;
6. medição de Class A/B, GiB-mês, egress e taxa de erro;
7. scanner de malware real e política de retenção aprovados.

Cloud Tasks/Jobs entram somente no download em lote. Workflows continua sem
justificativa para o fluxo individual.
