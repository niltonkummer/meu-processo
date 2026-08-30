# Implantação de validação — 29/08/2026

## Escopo

Primeira implantação da aplicação Meu Processo no projeto
`meu-processo-507018`, sem banco de dados, cache, fila ou persistência de dados
judiciais. O cadastro continua armazenado somente no navegador e a API é
stateless.

## Recursos

- região: `southamerica-east1`;
- estado Terraform: `gs://meu-processo-507018-terraform-state`;
- Artifact Registry: `meu-processo`;
- KMS key ring: `meu-processo-artifacts`;
- KMS key: `artifact-registry`, com rotação de 90 dias;
- identidade de runtime: `meu-processo-runtime`;
- Cloud Run privado: `meu-processo-mvp`;
- URL: `https://meu-processo-mvp-rsirxb5ptq-rj.a.run.app`;
- revisão validada: `meu-processo-mvp-00002-6x6`;
- imagem: `app:76581d4cb3a6822c2ac1ca83c387ee47cc7e24a0`;
- digest publicado: `sha256:61fbf766ed3035ea7f91e62ce322d4982138d70b2e920a54ce4ac561c05c9fc5`.

O serviço escala de zero a duas instâncias, usa uma CPU, 512 MiB e não possui
papéis de projeto atribuídos à identidade de runtime. Não existe vínculo
`allUsers` no Cloud Run.

## Evidências

- acesso anônimo: HTTP 403;
- `GET /health` autenticado: HTTP 200 com `{"ok":true}`;
- frontend autenticado: HTTP 200;
- consulta pelo nome validado: 16 publicações, 3 processos, zero publicações
  órfãs e nenhuma truncagem;
- Terraform pós-implantação: `No changes`;
- 31 testes e cobertura de 100% no núcleo;
- npm audit: zero vulnerabilidades;
- Trivy da imagem final: zero HIGH, zero CRITICAL e zero segredos;
- Checkov: quatro políticas GCP aprovadas e zero falhas.

## Decisão sobre health check

O caminho `/healthz` é reservado pelo Google Frontend do Cloud Run e retorna
HTTP 404 antes de alcançar o container. O contrato e os probes foram alterados
para `/health`, que foi validado interna e externamente.

## Acesso operacional

O serviço permanece privado. Para usar a interface localmente com a identidade
do `gcloud`:

```sh
gcloud run services proxy meu-processo-mvp \
  --project meu-processo-507018 \
  --region southamerica-east1 \
  --port 8081
```

Abra `http://localhost:8081`. Não torne a API pública antes de adicionar
autenticação da aplicação, rate limiting e controles de abuso/custo.

## Pendências antes de automatizar deploys

1. Criar Workload Identity Federation para o GitHub Actions.
2. Criar conta de deploy com permissões mínimas e ambiente protegido.
3. Configurar `GCP_TF_STATE_BUCKET`, `GCP_WORKLOAD_IDENTITY_PROVIDER` e
   `GCP_DEPLOY_SERVICE_ACCOUNT` no GitHub.
4. Commitar e revisar esta primeira baseline antes do próximo deploy.
