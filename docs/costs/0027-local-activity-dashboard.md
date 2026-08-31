# Cost gate 0027 — painel local de alertas e linha do tempo

Status: aprovado para implementação local em 2026-08-31.

## Escopo

- consumir as APIs autenticadas já existentes de alertas e eventos;
- apresentar caixa de acompanhamento e linha do tempo nos modos simples e
  avançado;
- marcar alertas como lidos e paginar sem armazenar dados no navegador;
- executar testes apenas com respostas sintéticas locais.

## Impacto financeiro

| Item | Alteração | Custo incremental neste marco |
|---|---|---:|
| Frontend local | componentes React e CSS no bundle existente | R$ 0 |
| API/PostgreSQL local | somente leitura e comando já implementados | R$ 0 |
| Cloud Run, Supabase, GCP, Infisical e Brevo | não ativados | R$ 0 |

Não há alteração de Terraform, capacidade, armazenamento remoto ou tráfego para
fontes judiciais. Infracost não se aplica porque o diff de infraestrutura é
zero. Publicação remota e volume real exigem avaliação separada.
