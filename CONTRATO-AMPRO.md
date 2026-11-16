
## 4.4 `POST /deliveries` — placar de entregas por usuário (AM PRO → Tax Manager, v1)

Corpo: `{ schemaVersion: 1, source: "ampro", kind: "user-deliveries", team: { id }, competence: "AAAA-MM", revision (SHA-256 hex), sourceUpdatedAt: { cycle, events }, totals, users: [...] }` com `Idempotency-Key` igual a `revision`.
Cada linha (totais e usuários): `activities, delivered, onTime, late, undated, open, score` ("no prazo/atividades", ex. `46/192`). Regras: `activities = delivered + open`; `delivered = onTime + late + undated`; `score = onTime/activities`; a soma dos usuários fecha com os totais.
Respostas: 200 (aceito ou revisão repetida), 400 corpo inválido ou contagens que não fecham, 403 equipe fora da chave, 409 placar mais antigo que o gravado, 413 corpo acima de 512 KB, 500 falha de gravação (nada é gravado pela metade).
Leitura no Tax Manager: `select nome, placar, no_prazo, atividades from ampro_entregas_usuarios where competencia = '2026-11'`.
