# Deploying CineForge to Fly.io

CineForge deploys as **one Docker image = one Python process**. The FastAPI backend
(`backend.app:app`) serves both the API and the canvas — Vite builds the React app into a
single self-contained `frontend/index.html` at image-build time, and `app.py` serves it at `/`.

State (projects, exports, mock media, QC frames) lives on a **Fly volume** at `/data`. The app
keeps a hot copy in memory and reloads from disk on restart, so it must run as a **single
machine** — do not `fly scale count` above 1.

## Files

- `Dockerfile` — stage 1 builds the canvas (Node), stage 2 is the Python runtime with ffmpeg.
- `.dockerignore` — keeps `.venv`, `node_modules`, `.data`, secrets out of the build context.
- `fly.toml` — one always-on `shared-cpu-1x` / 1GB machine, a `cineforge_data` volume at `/data`.

## First deploy (mock mode — free, no keys)

```bash
# 1. Log in (once).
fly auth login

# 2. Pick a globally-unique app name. Either edit `app = ` in fly.toml by hand, or:
fly launch --no-deploy --copy-config --name <your-unique-name> --region iad

# 3. Create the persistent volume in the same region as the app (1GB is plenty to start).
fly volumes create cineforge_data --region iad --size 1

# 4. Ship it.
fly deploy
```

Then open the app:

```bash
fly open
```

Verify it's up: `fly open /api/health` should report `"mock_mode": true`, `"storage": "local"`.

## Flip to real generation later (no rebuild needed)

The image already includes the genblaze stack, so going live is just secrets + a restart. The
B2 bucket **must be public** (the canvas renders media URLs straight into `<img>`/`<video>`; a
private bucket 403s and every asset breaks).

```bash
fly secrets set \
  MOCK_MODE=false \
  GMI_API_KEY=... \
  B2_KEY_ID=... B2_APP_KEY=... B2_BUCKET=cineforge B2_REGION=us-west-004 \
  OPENAI_API_KEY=...        # strongly recommended — the QC judge is a vision call
```

Setting secrets triggers a rolling restart automatically. `/api/health` should then show
`"media_live": true`, `"storage": "b2"`.

## Turn on multi-user login later (optional)

Auth is off by default — the app runs single-user, every request as `local`. To make it
multi-user, rent identity from a free **Supabase** project (no user tables of our own; film
data stays in B2/`/data`, now stamped with an `owner_id` and scoped per user).

1. Create a Supabase project. From **Project Settings → API** grab the **Project URL**, the
   **anon key**, and the **JWT secret**.
2. Backend secret (verifies tokens): `fly secrets set SUPABASE_JWT_SECRET=...`
   (also set `SUPABASE_URL=...` and `SUPABASE_ANON_KEY=...` if your project uses the newer
   asymmetric signing keys instead of a JWT secret — the backend then verifies remotely).
3. Frontend build vars (bundled into the canvas at image-build time — pass as build args or
   set in `frontend/.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. In Supabase **Auth → URL Configuration**, add your Fly URL to the redirect allow-list so the
   magic-link / OAuth redirect returns to the deployed app.

Email magic-link works out of the box; Google login needs the provider enabled in the Supabase
dashboard. With none of these set, everything above is a no-op and the app stays single-user.

> **Routing note:** the canvas is client-routed (`/`, `/p/:id` per film). `app.py` has an SPA
> fallback that serves `index.html` for any non-`/api` path, so refreshing or sharing a
> `/p/:id` deep link resolves. No Fly-side config needed.

## Operating

```bash
fly logs                    # tail
fly ssh console             # shell into the machine (inspect /data)
fly deploy                  # redeploy after code changes
fly status                  # machine + volume health
```

### Notes / gotchas

- **Single machine only.** The volume pins the app to one machine in `primary_region`.
  Scaling out would split project state across machines.
- **Cost.** `auto_stop_machines = "off"` keeps the one machine always-on (predictable for a
  demo). Because state reloads from `/data` on boot, you can switch it to `"stop"` in `fly.toml`
  to let Fly idle the machine and save money — at the cost of cold-start latency on the first
  request after idle.
- **SSE.** The run/edit endpoints stream Server-Sent Events; Fly's proxy passes them through
  and the app already sets `X-Accel-Buffering: no`. No extra config needed.
- **ffmpeg** is baked into the image for the final-cut export.
