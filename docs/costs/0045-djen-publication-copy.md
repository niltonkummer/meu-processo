# Avaliação de custo 0045 — cópia PDF da publicação DJEN

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação e rollout de validação
**Solicitado por:** proprietário do produto
**Responsável:** engenharia do Meu Processo
**Data da avaliação:** 31 de agosto de 2026
**Ambientes afetados:** `validation` no projeto `meu-processo-507018`
**Spec/issue:** [Spec 0035](../specs/0035-djen-publication-copy.md)

**Custo mensal atual (USD):** até US$ 1,71 fixo; US$ 2,25 operacional
**Custo mensal esperado (USD):** até US$ 1,71 fixo; delta variável < US$ 0,05
**Custo mensal limite (USD):** US$ 2,30 operacional; US$ 10,00 de segurança
**Aprovação:** autorização permanente do proprietário para avançar abaixo de
US$ 10/mês

## Decisão e delta

A geração usa a API e o Cloud Run existentes, sob demanda, com escala mínima
zero. Não cria bucket, banco, fila, cache, scheduler, IP, proxy pago ou instância
mínima. O único delta é CPU/memória durante a criação do PDF e crescimento
desprezível da imagem da aplicação pela biblioteca de PDF.

| Componente | Alteração | Delta mensal esperado |
|---|---|---:|
| Cloud Run API | geração de PDF sob demanda, limites atuais preservados | < US$ 0,05 |
| DJEN | uma releitura exata por download | US$ 0 |
| Artifact Registry | nova camada da imagem | < US$ 0,01 |
| Renderer/eproc | não participa da cópia DJEN | US$ 0 |
| GCS/PostgreSQL | nenhuma gravação nesta etapa | US$ 0 |

## Guardrails

- limite de 20 downloads por usuário/minuto compartilhado com documentos;
- conteúdo oficial limitado e rejeitado sem truncamento silencioso;
- PDF em memória limitado a 25 MiB;
- nenhum retry automático do DJEN e nenhum acesso ao eproc para a cópia;
- testes, auditoria, SBOM, scans High/Critical e Infracost continuam
  obrigatórios;
- cinco falhas consecutivas, consumo projetado acima de US$ 10 ou finding
  High/Critical interrompem o rollout.

## Rollout e rollback

Publicar em PR, executar todos os gates e deploy OIDC em `validation`. Validar
download autenticado, hash, texto, layout e diferenciação visual. Em falha,
direcionar tráfego à revisão anterior. A `main`, produção, cobrança real e
bypass de CAPTCHA não estão autorizados.
Validade até 30/09/2026 ou mudança de preço, capacidade, retenção ou
arquitetura, o que ocorrer primeiro.
