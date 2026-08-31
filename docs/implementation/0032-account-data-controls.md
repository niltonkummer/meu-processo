# Implementação 0032 — controles de dados da conta

**Status:** completa no ambiente local/CI; ativação cloud fora de escopo  
**Data:** 31 de agosto de 2026  
**Spec:** [0028](../specs/0028-account-data-controls.md)  
**Threat model:** [0008](../security/0008-account-data-controls-threat-model.md)  
**Custo:** [0035](../costs/0035-local-account-data-controls.md)

## Resultado

- quatro operações privadas v1 para solicitar exportação, consultar estado,
  baixar JSON e solicitar exclusão;
- tenant sempre derivado da identidade e projeção SQL de menor privilégio;
- download pelo servidor sem expor locator, com TTL, tamanho e SHA-256
  conferidos, `attachment`, CSP sandbox, `nosniff` e `private, no-store`;
- Firebase preserva `auth_time`; exclusão exige reautenticação nos últimos
  cinco minutos e a frase exata `EXCLUIR MINHA CONTA`;
- painel responsivo, profissional e acessível com estados de fila, atualização
  manual, download e zona de perigo; token e senha permanecem em memória;
- OpenAPI ampliado de 15 para 19 operações;
- migração 0014 para a projeção tenant-bound e migração 0015 para corrigir a
  monotonicidade descoberta sob concorrência no contador de downloads.

O guia de frontend orientou a hierarquia visual editorial/industrial contida e
o carregamento sem dependências novas. Os guias React e segurança determinaram
Bearer em memória, autorização repetida no servidor, ausência de HTML bruto,
destinos same-origin e confirmação destrutiva com autenticação recente.

## Evidência

- 77 arquivos e 948 testes locais após os testes específicos de UI;
- cobertura core 100%: 1.733 statements, 1.325 branches, 351 functions e 1.592
  lines no gate medido;
- 13 arquivos/253 asserts pgTAP;
- 11 arquivos/35 contratos PostgreSQL, incluindo ausência cross-tenant;
- contrato HTTP confirma que locator e hash interno não vazam;
- lint, typecheck, OpenAPI, build e Docker build aprovados;
- actionlint e hadolint aprovados, secret scan limpo e imagem de produção com
  zero High/Critical no Trivy; `npm audit` mantém nove moderadas transitivas já
  conhecidas no tooling Firebase, sem High/Critical;
- Compose com banco efêmero aprovou pgTAP e contratos após corrigir a corrida
  temporal antiga; o projeto sintético foi removido com seu volume.

## Operação local

O pedido aparece como `pending` até a execução one-shot do serviço
`tenant-data-lifecycle-worker`. A UI apenas consulta o estado; não há rota para
disparar o worker. Após a conclusão, o botão de download aparece enquanto o TTL
estiver válido. A exclusão aceita congela a conta e encerra a sessão do painel.

## Limite e próximo gate

Não houve commit, push, deploy, dado real ou ativação de Supabase, GCS, Cloud
Run, Brevo ou Infisical. A operação gerenciada precisa de nova avaliação de
custo e deve tratar scheduler/job, bucket privado, lifecycle, observabilidade,
restauração e reconciliação antes de qualquer piloto.
