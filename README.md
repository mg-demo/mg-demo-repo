# mergeguard-demo-app

Public demo repository with **intentional** bugs, weak security, bad patterns, and inefficient code. Use it to exercise review tools, static analysis, and policy checks without touching production code.

## What is wrong here (on purpose)

| Area | Examples |
|------|----------|
| Security | Default JWT secret, open redirect (`/api/public/redirect`), permissive CORS, session dump endpoint, client-trusted `role`, payment logging |
| Bugs | Loose equality on password check, fragile JSON/query login parsing, error responses include stack traces |
| Bad patterns | Global mutable counters, string building in hot paths, in-memory sessions, float money |
| Performance | Nested-loop “reconciliation” on every charge, ReDoS-prone username regex |

## Run locally

```bash
cd demo
npm start
```

Optional: `set JWT_SECRET=...` (Windows) before start.

## Fake pull requests (branches)

After you push this repo to GitHub (or similar), open **three PRs** from these branches into `main`:

| Branch | Suggested PR title |
|--------|-------------------|
| `pr/fix-auth-middleware` | Fix auth middleware |
| `pr/refactor-payment-logic` | Refactor payment logic |
| `pr/update-api-validation` | Update API validation |

Each branch changes one area. **Merging does not imply the codebase is safe** — branches fix or refactor partially; `main` plus branches are all still demo-quality.

### Create branches locally (already in this clone)

```bash
git fetch --all
git checkout pr/fix-auth-middleware
```

Push all branches:

```bash
git push -u origin main
git push -u origin pr/fix-auth-middleware
git push -u origin pr/refactor-payment-logic
git push -u origin pr/update-api-validation
```

Then open PRs in the hosting UI from each `pr/*` branch → `main`.

## License

MIT — demo only, no warranty.
