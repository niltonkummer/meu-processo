# Modelo de ameaça 0002 — borda pública e proxy judicial

**Data:** 30 de agosto de 2026
**Escopo:** Spec 0004, ambiente `validation`

## Ativos e fronteiras

Ativos: identidade Firebase, token em memória, consultas do usuário, números de
processo, PDFs públicos, disponibilidade da cota DJEN e orçamento GCP.
Fronteiras: navegador → Cloud Run público; Cloud Run → Firebase; Cloud Run no
Brasil → DJEN; Cloud Run → host TJRS autorizado.

## Ameaças e controles

| Ameaça | Impacto | Controle verificável |
|---|---|---|
| chamada anônima a API cara | abuso/custo/bloqueio DJEN | todas as rotas `/api/` autenticadas; 401 antes da origem |
| token falsificado, expirado ou revogado | acesso indevido | Firebase Admin com revocation check e e-mail confirmado |
| URL/host/IP controlado pelo cliente | SSRF e exfiltração | contrato aceita apenas CNJ/número; URL vem da reconsulta DJEN |
| DJEN devolve referência misturada | documento errado | CNJ e número da comunicação devem coincidir exatamente |
| DNS rebinding/redirect privado | acesso à rede interna | IP público fixado por conexão e cada redirect revalidado |
| HTML/PDF ativo ou arquivo enorme | XSS/DoS/memória | PDF `%PDF-`, 25 MiB, dois downloads, anexo, sandbox/no-store |
| imagem de desafio maliciosa | XSS, rastreamento ou consumo de memória | somente data URL PNG/JPEG/GIF com MIME+assinatura, 512 KiB; SVG/HTML/URL rejeitados |
| desafio reutilizado ou trocado entre usuários/processos | documento incorreto ou sessão judicial exposta | vínculo exato ao usuário/referência/URL, uso único, TTL de 2 minutos e cookies apenas no mesmo host |
| automação do CAPTCHA | violação do controle da fonte | resposta vem somente do usuário; nenhum solver, OCR, navegador ou terceiro |
| perda da instância entre imagem e resposta | falha de disponibilidade | afinidade de melhor esforço; estado ausente expira fechado e exige nova imagem |
| enumeração e scraping por usuário válido | bloqueio da fonte/custo | 10 buscas e 20 downloads/minuto/UID/instância; sem retries por IP |
| vazamento em logs/cache | exposição jurídica/token | erros estáveis, sem URLs/tokens/conteúdo e cache privado desabilitado |
| exposição prematura da revisão antiga | API pública sem auth | rollout privado primeiro; binding público em aplicação separada |
| confusão por homônimo | decisão jurídica errada | aviso explícito; agrupamento apenas por CNJ; sem alegação de titularidade |

## Risco residual aceito somente em validation

O limite em memória não é global entre as duas instâncias e tráfego de arquivos
estáticos pode alcançar o container anonimamente. `max_instance_count = 2`,
escala a zero, limite financeiro de US$ 10 e rollback do binding reduzem o
impacto. Produção exige rate limit global/Cloud Armor ou gateway equivalente,
alerta financeiro e revisão jurídica/LGPD.
