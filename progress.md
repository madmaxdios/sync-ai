# Envío al directorio de Anthropic

Objetivo: publicar `sync-ai` en el directorio de Claude (claude.ai/directory/manage).
Revisión hecha el 2026-11-04 contra la checklist previa al envío
(https://claude.com/docs/plugins/pre-submission-checklist).

## Pendiente antes de enviar

- [ ] Fusionar `chore/publish-all-marketplaces` en `main` (va 1 commit por delante: `48a2ea3`) y decidir qué rama sigue el directorio.
- [x] Corregir la intro del README: la ruta pasa a `.claude-plugin/plugin.json` y la nota se movió debajo de la descripción.
- [x] Añadir la sección "What this plugin runs and sends" al README: qué ejecuta, a qué se conecta (solo el remoto del repo de datos y `gh` en `init`), qué envía y dónde funciona.
- [x] Auto-push: sigue activo por defecto, pero ahora se destaca en esa sección junto con `AGENT_SYNC_AUTO_PUSH=0`. Si el revisor lo objeta, la alternativa es hacerlo opt-in.
- [x] Indicar en el README que es para Claude Code (Chat ignora los hooks; Cowork solo en sesiones locales).
- [x] Añadir `displayName` ("sync-ai: AI agent config sync") en `.claude-plugin/plugin.json`, sin nombres de marca para evitar "Name matches a known brand".
- [ ] Commitear README, `plugin.json`, `progress.md` y `todos.md` (o excluir estos dos últimos, porque viajan con el plugin).
- [ ] Arreglar `tests/file-system.test.ts`: espera permisos `0o755`, que Windows no conserva. Falla en local también sin estos cambios; saltarlo en `win32` o comprobar el bit solo en POSIX.
- [ ] Pulsar **Validate** en el portal, corregir todo lo marcado como **Blocking** y enviar.

## Retenciones esperadas (no bloquean, las revisa una persona)

- [ ] `dist/agent-sync.mjs` pesa 892 KB, por encima del límite de 256 KiB, así que se retiene ("Files or downloads the validator couldn't inspect"). Aceptarlo o reducir el bundle (ver `todos.md`).
- [ ] `package.json` + `package-lock.json` en la raíz del plugin: retención "Dependencies install from a lockfile". No se pueden sacar sin mover el plugin a una subcarpeta, y eso endurece otras reglas (el hook ejecuta un `.mjs`, no un script de shell). Recomendado: dejar el plugin en la raíz y aceptar la retención.

## Ya cumple

- [x] `claude plugin validate --strict` pasa en `marketplace.json` y `plugin.json`.
- [x] `LICENSE` y `license: MIT`; README de ~2900 palabras; `description`, `author` y `version` definidos.
- [x] 132 archivos (límite 512); sin `.DS_Store`, `Thumbs.db` ni nombres inválidos en Windows; icono SVG.
- [x] Sin servidores MCP, sin lanzadores `npx`/`uvx` y sin `.npmrc`.
- [x] No lee `GITHUB_TOKEN` ni otras credenciales del entorno; `gh` usa su propia sesión.
- [x] Los tests construyen las cabeceras de clave privada por partes, así que no hay secretos literales en el repo.
- [x] Hooks con eventos válidos y rutas con `${CLAUDE_PLUGIN_ROOT}`.
