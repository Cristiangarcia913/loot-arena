# Seguridad

Loot Arena es un proyecto educativo que funciona en la testnet **Sepolia**. Los
objetos NFT no tienen valor económico.

## Informar de una vulnerabilidad

Si encuentras un problema de seguridad (en el contrato, el servidor o la web) o un
secreto expuesto en este repositorio, **no abras un issue público**. Usa
*Security → Report a vulnerability* (aviso privado de GitHub) en este repositorio.
Intentaremos responder en unos días.

## Secretos

Este repositorio no contiene ni debe contener claves privadas, mnemonics, API keys
ni archivos `.env`. Cada commit y push pasa por un escáner propio
(`scripts/check-secrets.mjs`) y por gitleaks, y GitHub tiene activado el secret
scanning con push protection. El procedimiento completo está en [PUBLICAR.md](PUBLICAR.md).

Las claves privadas de las cuentas por defecto de Hardhat que puedan aparecer en
tests son públicas y solo válidas en la red local de desarrollo.
