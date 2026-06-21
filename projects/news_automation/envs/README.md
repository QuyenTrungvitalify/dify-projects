# Env files

Per-environment config files. `.env.example` files are commited (templates); the
actual `*.env` files are gitignored.

Workflow:

```bash
cp dev.env.example dev.env
# Edit dev.env, fill in secrets
```

Load before running anything against Dify:

```bash
set -a; source envs/dev.env; set +a
# Or via direnv: echo "dotenv envs/dev.env" > .envrc && direnv allow
```
