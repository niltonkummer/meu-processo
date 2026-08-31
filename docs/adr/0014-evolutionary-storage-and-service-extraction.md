# ADR 0014 — armazenamento evolutivo e extração guiada por métricas

**Status:** aceito; escolha de Firestore substituída pela [ADR 0016](./0016-managed-supabase-postgres.md)
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0009](../specs/0009-scalable-product-foundation.md)

## Contexto

O roadmap pode futuramente exigir dados relacionais, pesquisa textual,
analytics, cache e múltiplos consumidores. Provisionar Cloud SQL, OpenSearch,
BigQuery, Redis, Pub/Sub ou Workflows preventivamente aumenta custo, operação e
superfície de segurança sem conhecer volume ou consultas reais.

## Decisão

Começar com, conforme atualizado pela ADR 0016:

- Supabase PostgreSQL gerenciado para controle operacional e integridade;
- Cloud Storage para originais, documentos e exportações com lifecycle;
- Scheduler e processamento local/Cloud Run para o primeiro fluxo;
- Tasks quando houver retry/rate limit durável por unidade.

Adicionar tecnologia somente após reproduzir um limite e medir o benefício:

- Cloud SQL como contingência se a fronteira Supabase/GCP falhar em custo,
  latência, residência ou disponibilidade;
- busca dedicada para texto livre e filtros que índices atuais não atendem;
- Redis para hot keys/cache/coordenação com ganho demonstrado;
- Pub/Sub para múltiplos consumidores independentes ou event streaming;
- Workflows para fluxos longos com dependências, compensações/aprovações;
- BigQuery para análise histórica, nunca como banco do painel.

Novo serviço exige contrato estável, owner, runbook, threat model, IaC, custo,
quota, migração e rollback. Extração de módulo segue os mesmos critérios.

## Consequências

- o MVP conserva escala a zero e baixa carga operacional;
- ports e contratos permitem substituir adapters sem contaminar o domínio;
- algumas otimizações serão feitas depois que o problema aparecer em teste/carga,
  não depois de incidente em produção;
- métricas e testes de capacidade tornam-se parte da Definition of Ready.

## Alternativas

- **Stack completa desde o início:** rejeitada por custo e complexidade.
- **Proibir evolução tecnológica:** rejeitada; gatilhos permitem mudança segura.
- **Multi-cloud genérico:** rejeitado; Supabase é uma exceção deliberada e
  mensurável, não licença para distribuir novos componentes entre provedores.

## Revisão

Revisar trimestralmente durante expansão ou quando SLO/custo falhar em teste de
carga. Nenhuma revisão autoriza novo serviço sem avaliação de custo específica.
