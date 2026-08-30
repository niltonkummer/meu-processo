# Implantação autenticada e abertura pública — 30/08/2026

## Escopo

Rollout privado de validação da aplicação autenticada e do worker isolado de
navegador no projeto `meu-processo-507018`. A mudança corresponde ao merge da
[PR #1](https://github.com/niltonkummer/meu-processo/pull/1) e à avaliação de
custo `docs/costs/0006-isolated-browser-renderer.md`.

Não foram adicionados banco de dados, cache, fila ou armazenamento de
documentos. O serviço continua stateless. A implantação começou privada e o
frontend foi aberto somente depois dos testes autenticados e da aprovação da
[PR #8](https://github.com/niltonkummer/meu-processo/pull/8).

## Artefatos imutáveis

- commit de origem: `0bba575a1bdd6f1a7e98f9e7d4ea5c9e3e95ed97`;
- aplicação: `app:0bba575a1bdd6f1a7e98f9e7d4ea5c9e3e95ed97`;
- digest da aplicação:
  `sha256:ffbacd54c4f2a2a8fb2721090151348c8a1fcf0b4f3e505974ef43d64cc9a022`;
- worker: `renderer:0bba575a1bdd6f1a7e98f9e7d4ea5c9e3e95ed97`;
- digest do worker:
  `sha256:8e6099daf5da6fd92ac5e93d052492487caa9f5aaf7af8c501814a786d1fd335`;
- as duas imagens foram publicadas com procedência e SBOM.

## Recursos e revisões

- região: `southamerica-east1`;
- aplicação privada: `meu-processo-mvp`;
- revisão da aplicação: `meu-processo-mvp-00028-8km`;
- worker privado: `meu-processo-browser-renderer`;
- revisão do worker: `meu-processo-browser-renderer-00001-vgs`;
- identidade sem privilégios do worker: `meu-processo-renderer`;
- somente `meu-processo-runtime` recebeu `roles/run.invoker` no worker;
- estado Terraform: `gs://meu-processo-507018-terraform-state`, prefixo
  `meu-processo/validation`.

O plano aplicado criou três recursos, atualizou um e não removeu nem substituiu
recursos. O plano pós-implantação retornou `No changes`.

## Evidências

- PR: todos os sete checks aprovados ou corretamente ignorados no bootstrap;
- suíte: 277 testes e cobertura de 100%;
- imagens: zero vulnerabilidades HIGH ou CRITICAL;
- aplicação sem identidade: HTTP 403;
- aplicação com identidade: `GET /health` HTTP 200;
- worker sem identidade: HTTP 403;
- worker com identidade: `GET /health` HTTP 200;
- membros públicos na aplicação: zero;
- membros públicos no worker: zero;
- frontend pelo proxy autenticado: HTTP 200;
- Terraform pós-implantação: nenhuma alteração pendente.

## Custo e limites

- custo estático estimado: US$ 0,02/mês;
- custo incremental esperado no cenário de validação: US$ 0,33/mês;
- limite operacional aprovado: US$ 10/mês;
- worker com zero instâncias mínimas, uma instância máxima e concorrência 1.

## Acesso para validação

O frontend está disponível em:

[https://meu-processo-mvp-rsirxb5ptq-rj.a.run.app](https://meu-processo-mvp-rsirxb5ptq-rj.a.run.app)

O acesso anônimo alcança somente a interface e os endpoints públicos de saúde.
Todas as rotas `/api/` continuam protegidas pelo Identity Platform e exigem um
token de usuário com e-mail verificado.

## Evidência da abertura pública

A PR #8 foi mesclada em `38a74f9a6c9e598fb2809d9f977476c7af69d97d`
após aprovação de testes, cobertura, revisão de dependências, Checkov, scans das
duas imagens e comparação Infracost. O plano Terraform final continha somente
uma atualização in-place: `invoker_iam_disabled` passou de `false` para `true`
na aplicação. Foram 0 criações, 1 atualização, 0 remoções e 0 substituições.

Após a aplicação do plano:

- frontend sem identidade: `GET /` HTTP 200;
- saúde da aplicação sem identidade: `GET /health` HTTP 200;
- API sem token Firebase: `GET /api/v1/session` HTTP 401;
- saúde do worker sem identidade: `GET /health` HTTP 403;
- membros públicos IAM na aplicação e no worker: zero;
- invocador do worker: somente `meu-processo-runtime`;
- revisões preservadas: aplicação `meu-processo-mvp-00028-8km` e worker
  `meu-processo-browser-renderer-00001-vgs`;
- plano Terraform pós-aplicação: `No changes`.

A abertura não criou binding `allUsers`; ela desativou a checagem IAM somente
na aplicação, de forma compatível com Domain Restricted Sharing. O worker
permanece privado e não teve sua checagem IAM desativada.

## Exceção de bootstrap e próximo passo

Este rollout foi aplicado manualmente a partir do plano Terraform salvo e
revisado porque a federação de identidade do GitHub ainda não existe. A
autorização foi explícita nesta tarefa, o serviço permaneceu privado e o plano
não continha remoções.

Antes do próximo rollout, criar Workload Identity Federation e a conta de
deploy com privilégio mínimo, configurar o ambiente protegido `validation` e
as variáveis documentadas em `.github/workflows/deploy.yml`. Depois disso,
aplicações manuais deixam de ser permitidas.
