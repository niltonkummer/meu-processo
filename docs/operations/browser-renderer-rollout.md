# Operação — sessão assistida do navegador

**Status:** implementação local pronta; rollout não autorizado
**Referências:** [Spec 0005](../specs/0005-assisted-browser-document-session.md),
[custo 0006](../costs/0006-isolated-browser-renderer.md) e
[ameaças 0003](../security/0003-browser-renderer-threat-model.md)

## Pré-condições

O rollout só pode começar após aprovação explícita e separada do proprietário.
Antes disso, não executar `terraform apply`, publicar imagens ou alterar o
serviço atual.

Para autorizar uma validação, devem estar verdes: lint, tipos, 100% de cobertura,
build, Compose, scan de dependências, scan das duas imagens, Terraform,
Infracost e validação dos workflows. A sessão do Google Cloud deve ser
reautenticada e o plano precisa confirmar exclusivamente os recursos aprovados
na avaliação 0006.

## Rollout controlado

1. Gerar imagens imutáveis da API e do renderizador, identificadas pelo SHA do
   commit, no Artifact Registry regional.
2. Executar o plano Terraform com as duas URIs imutáveis e anexar o plano e o
   diff Infracost à aprovação manual do ambiente `validation`.
3. Confirmar que o renderizador não possui `allUsers` ou `allAuthenticatedUsers`,
   tem escala 0–1, concorrência 1, timeout de 120 segundos e somente a conta da
   API com `roles/run.invoker`.
4. Aplicar primeiro o renderizador privado e validar `/health` usando identidade
   de serviço; acesso anônimo deve falhar.
5. Atualizar a API com o endpoint interno e validar autenticação, re-resolução
   DJEN e os bloqueios de host/IP usando o smoke sintético.
6. Executar uma única sessão real autorizada. O usuário resolve o desafio; não
   há OCR, solver ou repetição automática.
7. Habilitar a ação do frontend somente após validar assinatura, tamanho e hash
   do PDF ponta a ponta.

## Observabilidade e privacidade

Monitorar quantidade de sessões, duração, código categórico, bytes entregues,
cold start e custo estimado. Logs nunca devem conter token, nome, CPF/CNPJ, CNJ,
comunicação, URL oficial, HTML, cookies, imagem do desafio ou PDF.

Interromper a validação após cinco falhas consecutivas da origem, projeção de
US$ 10 incrementais ou 2.000 documentos no mês. Alertas de orçamento não são
hard cap; os limites da aplicação e a escala máxima são a barreira operacional.

## Rollback

1. Reimplantar a revisão anterior da API, sem o endpoint do renderizador.
2. Confirmar que o frontend voltou ao fluxo anterior e que novas sessões não
   alcançam o serviço privado.
3. Manter o renderizador privado em escala a zero. A exclusão exige aprovação
   própria porque há proteção contra remoção acidental.
4. Registrar motivo, horário, revisão e métricas categóricas, sem dados do
   processo.

Revisar custo e comportamento em D+1, D+7 e D+30 conforme a avaliação 0006.
