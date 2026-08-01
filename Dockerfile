# CineForge — one image, two stages.
#
# Stage 1 builds the React canvas into the single self-contained frontend/index.html that
# backend/app.py serves at "/". Stage 2 is the FastAPI runtime (with ffmpeg for the final-cut
# export) and copies that one built file in. The whole app is this one Python process.

# ---- stage 1: build the single-file canvas ----------------------------------
FROM node:20-slim AS frontend
WORKDIR /app/frontend
# Install deps first for layer caching; lockfile is optional so the build still works if it
# drifts from package.json.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
# vite.config.js has root:'src', outDir:'..' -> writes /app/frontend/index.html. postcss +
# tailwind configs must be copied too, or Vite builds without Tailwind and `@tailwind utilities`
# passes through as dead text -> the landing renders with no layout utilities.
COPY frontend/vite.config.js frontend/postcss.config.js frontend/tailwind.config.js ./
COPY frontend/src ./src
# Optional auth: pass these build args to bake Supabase login into the canvas. Omit them and
# the app builds single-user (no login gate). Vite inlines VITE_-prefixed vars at build time.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

# ---- stage 2: the FastAPI runtime -------------------------------------------
FROM python:3.12-slim AS runtime

# ffmpeg is required by pipeline/export.py to stitch the final cut.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps (includes the genblaze stack, so flipping MOCK_MODE=false needs no rebuild).
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# App code + the built canvas. app.py resolves FRONTEND as ../frontend and serves index.html.
COPY backend/ backend/
COPY --from=frontend /app/frontend/index.html frontend/index.html

# Persistent state (projects, exports, mock media, qc frames) lives on the Fly volume at /data.
ENV DATA_DIR=/data \
    MOCK_MODE=true \
    PYTHONUNBUFFERED=1

EXPOSE 8080
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
