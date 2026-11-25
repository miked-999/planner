# Simplified Project & Resource Planner (v0.2)

A lightweight, locally hosted web application for high-level project planning, team capacity allocation, Finish-to-Start dependency cascade previews, and What-if scheduling alongside Jira.

## Quick Start

### Production / Single-Server Mode (`http://127.0.0.1:8000`)

Builds the frontend once and serves both the SPA and SQLite REST API from FastAPI:

```sh
make start
```

### Development Mode (Hot Reload)

Run the FastAPI server (`:8000`) and Vite dev server (`:5173`) in two terminals:

```sh
make dev-backend
make dev-frontend
```

### Running Tests

```sh
make test
```

## Data Storage

- Live database: `data/planner.db` (SQLite WAL mode, auto-saved on every edit)
- Snapshots: `data/backups/*.db`
- Lossless JSON & Excel CSV exports available via **Import / Export** in the top bar.
