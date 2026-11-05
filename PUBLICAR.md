# Procedimiento de publicación (repo público)

Este repositorio es **público**. Nunca debe contener: claves privadas de wallet,
mnemonics, URLs RPC con API key (Alchemy/Infura/…), API keys de Etherscan, tokens
(GitHub, OpenAI, Render…) ni ningún archivo `.env` (solo `.env.example`).
Los secretos viven en `contracts/.env` y `server/.env` (ignorados) y, en producción,
en las variables de entorno de Render.

## Barreras activas

| Capa | Qué hace | Dónde |
|---|---|---|
| `.gitignore` | Ignora `.env*` (salvo `.env.example`), `*.pem`, `*.key`, `keystore*`, `node_modules`, `artifacts`, `cache`, `coverage`, `typechain-types`, `.claude/` | raíz + `contracts/`, `server/` |
| `scripts/check-secrets.mjs` | Escáner propio sin dependencias (claves hex, mnemonics, URLs RPC, Etherscan, tokens, PEM, `.env`) | se ejecuta a mano y en los hooks |
| Hook `pre-commit` | `check-secrets` sobre lo staged + `gitleaks git --pre-commit --staged` | `.githooks/` |
| Hook `pre-push` | `check-secrets` sobre **todos** los commits que se suben + árbol completo + `gitleaks git` (historial) | `.githooks/` |
| CI `secret-scan.yml` | `check-secrets --all`, `check-secrets --rev HEAD` y `gitleaks-action` en cada push/PR | `.github/workflows/` |
| GitHub | Secret scanning + push protection activados en el repo | ajustes del repo |

Activar los hooks en un clon nuevo (una vez):

```bash
git config core.hooksPath .githooks
```

Instalar gitleaks (Windows): `winget install Gitleaks.Gitleaks`. Sin gitleaks los hooks
siguen funcionando con el escáner propio, pero avisan.

## Checklist antes de CADA push

1. `git status --ignored` → `contracts/.env` y `server/.env` aparecen en *Ignored*, nunca en *Untracked*/*Changes*.
2. `git add -A --dry-run` → revisar a mano la lista. Nada de `.env`, `*.key`, `*.pem`, `keystore*`, `node_modules/`, `artifacts/`.
3. `node scripts/check-secrets.mjs --all` → debe decir `OK`.
4. `gitleaks git --redact --config .gitleaks.toml .` (historial) y, antes del primer commit, `gitleaks dir` sobre una copia de los archivos que lista `git ls-files -co --exclude-standard`. Usar **siempre** `--redact`.
5. Commit (el hook `pre-commit` vuelve a escanear). **Nunca** `--no-verify`.
6. Push (el hook `pre-push` escanea todos los commits nuevos). **Nunca** `--no-verify`.
7. Tras el push: comprobar que el workflow *Escaneo de secretos* pasa en GitHub Actions.

## Publicación inicial (una sola vez)

```bash
gh repo create Cristiangarcia913/loot-arena --public --source . --push
gh api -X PATCH repos/Cristiangarcia913/loot-arena -f "security_and_analysis[secret_scanning][status]=enabled" -f "security_and_analysis[secret_scanning_push_protection][status]=enabled"
gh api -X POST repos/Cristiangarcia913/loot-arena/pages -f build_type=workflow
```

## Si se cuela un secreto

1. **Rotar primero**: da la clave por comprometida aunque borres el commit (los bots
   rastrean GitHub en segundos). Wallet → crear otra y mover fondos; Alchemy/Infura/
   Etherscan/GitHub → revocar y generar una nueva; actualizar `.env` y Render.
2. Si aún no se ha subido: `git reset --soft HEAD~1`, quitar el secreto, volver a commitear.
3. Si ya se subió: reescribir el historial (`git filter-repo`) y forzar el push, además de rotar.

## Falsos positivos

- Hashes de tx/bloque (`0x` + 64 hex) se aceptan en `shared/deployments.json`,
  `web/config/deployments.json`, `docs/` y en líneas con contexto de hash (`txHash`, `blockHash`…).
- Direcciones (`0x` + 40 hex) nunca se marcan.
- Para un falso positivo claro, añade `secret-scan:allow` en la misma línea. No sirve
  para claves en contexto `PRIVATE_KEY`/`mnemonic`, tokens, PEM ni `.env`.

## Allowlist de Hardhat

Las 20 cuentas por defecto de Hardhat (mnemonic público `test test … junk`) tienen claves
privadas públicas, sin valor en redes reales. `check-secrets.mjs` las permite comparando
su **SHA-256** (no guarda los literales). Para regenerar los hashes, derivar las cuentas
`m/44'/60'/0'/0/0..19` con ethers desde `contracts/node_modules` y calcular
`sha256(privateKey sin 0x, en minúsculas)`. Nunca uses estas cuentas en Sepolia/mainnet.
