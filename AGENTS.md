# Repository Guidelines

## Project Structure & Module Organization
- `backend/app`: FastAPI application code (routers, services, models).
- `backend/tests`: backend test suite (pytest + hypothesis).
- `backend/alembic`: database migrations.
- `frontend/src`: React + TypeScript UI; `frontend/public` for static assets.
- `docs/`: operational and security docs.
- `team`: CLI wrapper for common Docker workflows.
- `docker-compose.yml` / `docker-compose.postgres.yml`: service definitions.

## Build, Test, and Development Commands
- `./team start` / `./team status` / `./team logs-*`: manage the Dockerized stack.
- `docker compose -f docker-compose.postgres.yml up -d --build`: build and start all services.
- `cd frontend && npm install && npm run dev`: run the Vite dev server.
- `cd frontend && npm run build` / `npm run preview`: build and preview the frontend bundle.
- `cd backend && pytest`: run backend tests (install deps from `backend/requirements*.txt`).

## Coding Style & Naming Conventions
- Frontend: 2-space indentation, ES modules, single quotes, no semicolons; React components in `PascalCase`, hooks in `useX`.
- Backend: 4-space indentation, `snake_case` for functions/variables, `PascalCase` for classes; add type hints where practical.
- No repo-wide formatter config is enforced; keep diffs minimal and match nearby style.

## Testing Guidelines
- Backend tests live in `backend/tests` and follow `test_*.py` naming.
- Prefer property tests for business rules (see existing `hypothesis` usage).
- No frontend test runner is configured; document manual UI checks in PRs.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Branch names: `feature/...`, `fix/...`, `hotfix/...` (see `CONTRIBUTING.md`).
- PRs should include a clear description, test commands/results, linked issues, and screenshots for UI changes.

## Security & Configuration Tips
- Store secrets in environment variables and follow `docs/SECURITY.md` and `docs/TOKEN_GUIDE.md`.
- For production changes, deploy via Docker and verify `http://localhost:18000/health`.
