# Repository Guidelines

## Project Structure & Module Organization
The project root is this directory. Server entry is `server.js`. Backend code lives in `src/`: `routes/` for HTTP endpoints, `services/` for business logic, and `utils/` for shared helpers such as auth and DB utilities. Frontend assets are split by app surface: `public/` for the shared login and operations UI, `public-factory/` for the management UI. Tests are in `test/`. Database setup and schema changes live in `scripts/` and `scripts/migrations/`. Reference docs live in `docs/`, while historical deployment copies live under `artifacts/`.

## Build, Test, and Development Commands
Run commands from this directory.

- `npm.cmd install`: install dependencies on Windows.
- `npm.cmd start`: start the Express server on the local ERP ports and unified routes.
- `npm.cmd test`: run the Node test suite in `test/*.test.js`.
- `npm.cmd run init-db`: initialize the SQLite database and apply migrations.
- `node --check public/js/main.js` and `node --check public-factory/js/factory.js`: quick syntax checks for high-risk frontend edits.

## Coding Style & Naming Conventions
Use 2-space indentation in HTML, CSS, and JS to match the existing files. Prefer plain JavaScript and existing Express patterns over new abstractions or libraries. Keep naming descriptive: `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for shared constants, and kebab-case-like IDs/classes only when already established in markup such as `user-menu-panel` or `orders-filter-panel`. Reuse existing UI tokens in `public/css/app.css` and `public-factory/css/factory.css` instead of adding one-off colors or spacing.

## Testing Guidelines
Tests use the built-in Node test runner with `assert`. Name new files `*.test.js` and keep them in `test/`. Add focused coverage when changing auth, routing, filtering, or deployment behavior. For UI-heavy changes without browser automation, pair static checks with a short manual verification note covering `/`, `/admin`, `/ops/shopify`, and `/ops/amazon` as applicable.

## Commit & Pull Request Guidelines
Recent history uses short imperative prefixes such as `fix:`, `feat:`, and occasional scoped UI commits like `UI:`. Follow that style: `fix: correct logout binding` or `feat: add profile update endpoint`. PRs should summarize user-visible changes, list validation steps, mention config or migration impact, and include screenshots for layout changes in `public/` or `public-factory/`.

## Security & Configuration Tips
Do not commit real database files, secrets, or `.env` values. Auth is enabled by default; use `NO_AUTH=1` only for local troubleshooting. Preserve storage keys (`twodrapes_token`, `twodrapes_user`) and existing route contracts unless the task explicitly changes authentication flow.
