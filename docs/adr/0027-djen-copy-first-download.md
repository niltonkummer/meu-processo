# ADR 0027 — download principal por reprodução oficial do DJEN

**Status:** aceito
**Data:** 31 de agosto de 2026
**Spec:** [0035](../specs/0035-djen-publication-copy.md)
**Custo:** [0045](../costs/0045-djen-publication-copy.md)

## Contexto

O DJEN fornece metadados e texto da comunicação em API oficial, mas o link do
documento pode delegar ao eproc. No smoke real, o renderer exibiu o CAPTCHA e
preservou a sessão, porém, após a resposta humana, não recebeu PDF nem novo
desafio antes do timeout. Acoplar o download básico a esse comportamento torna
uma informação já pública indisponível por uma dependência secundária.

## Decisão

O download padrão será uma reprodução PDF produzida pelo backend a partir da
comunicação relida no DJEN. O documento original do tribunal continuará como
ação distinta e experimental. O PDF gerado terá rotulagem e metadados que
impeçam confusão com peça original, assinatura, certidão ou cópia autenticada.

A geração ocorre sob demanda e em memória no Cloud Run existente. Esta etapa
não persiste o arquivo em GCS; materialização e deduplicação permanecem na
fundação de documentos já especificada.

## Alternativas rejeitadas

- **Contornar ou resolver CAPTCHA:** fora dos limites de segurança e não remove
  a instabilidade após o desafio.
- **Continuar apenas com o eproc:** mantém falha conhecida como caminho único.
- **Baixar HTML ou JSON cru:** tecnicamente simples, mas inadequado para pessoa
  física e pouco portátil para impressão e arquivamento.
- **Gerar PDF no navegador:** permite alteração do payload pelo cliente e
  dificulta produzir hash e contrato uniformes.
- **Persistir toda cópia no GCS agora:** adiciona lifecycle, banco e custo antes
  de validar uso e formato.

## Consequências

- a publicação textual fica disponível sem CAPTCHA e com origem explícita;
- o original continua sujeito ao tribunal e pode falhar;
- o Cloud Run consome CPU apenas durante a geração e continua escalando a zero;
- a cópia poderá ser materializada em GCS posteriormente sem mudar seu contrato
  de autorização e identidade exata.
