# Simplified Project & Resource Planner (v0.2)

A lightweight, locally hosted web application for high-level project planning, team capacity allocation, Finish-to-Start dependency cascade previews, unscheduled backlog management, and What-if scheduling alongside Jira.

---

## Quick Start — macOS / Linux

Requires **Python 3.11+** (with [`uv`](https://docs.astral.sh/uv/)) and **Node.js 20+**.

### Production / Single-Server Mode (`http://127.0.0.1:8000`)

Installs/builds the frontend and serves both the SPA and SQLite REST API from FastAPI:

```sh
make install   # first time only
make start
```

### Development Mode (Hot Reload)

Run the FastAPI server (`:8000`) and Vite dev server (`:5173`) in two terminals:

```sh
make dev-backend
make dev-frontend
```

---

## Quick Start — Windows

> **Important when copying files across OSes**: Never copy `frontend/node_modules` or `backend/.venv` from macOS to Windows—they contain OS-specific binaries. Always let Windows create its own `backend\.venv` (and `node_modules`, if building on Windows).

### Easiest Way: Helper Batch Scripts (`setup.bat` & `start.bat`)

1. Run `setup.bat` once (double-click or run `.\setup.bat` in PowerShell / Command Prompt):
   - Creates `backend\.venv` and installs FastAPI + Uvicorn from `backend\requirements.txt`.
   - If Node.js/`npm` is installed, automatically installs frontend dependencies and builds `frontend\dist`.
   - If Node.js/`npm` is **not** installed, uses an existing pre-built `frontend\dist` folder if present.
2. Run `start.bat` anytime to open **http://127.0.0.1:8000** in your browser and start the local server.

---

### Manual PowerShell Instructions

#### Option A: Full Setup from `git clone` (Python 3.11+ and Node.js 20+ installed)

```powershell
# 1. Install Windows frontend packages & build frontend/dist
npm --prefix frontend install
npm --prefix frontend run build

# 2. Create Windows Python virtual environment & install backend packages
python -m venv backend\.venv
backend\.venv\Scripts\pip install -r backend\requirements.txt

# 3. Start the application on http://127.0.0.1:8000
backend\.venv\Scripts\uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

*(If you use `uv` on Windows instead of `venv`/`pip`, you can also run `uv sync --directory backend` and `uv run --directory backend uvicorn app.main:app --host 127.0.0.1 --port 8000`.)*

#### Option B: Python-Only Setup (No Node.js or `npm` on Windows)

If your Windows PC only has **Python 3.11+** installed:

1. Build `frontend/dist` on another machine (`npm --prefix frontend run build`) and copy the resulting `frontend\dist` folder into `planner\frontend\dist` on the Windows PC *(note: `frontend/dist` is git-ignored by default)*.
2. Open PowerShell in the `planner` folder and run:

```powershell
# One-time setup
python -m venv backend\.venv
backend\.venv\Scripts\pip install -r backend\requirements.txt

# Start the server
backend\.venv\Scripts\uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

3. Open **http://127.0.0.1:8000** in Edge or Chrome.

---

## Running Tests

**macOS / Linux:**
```sh
make test
```

**Windows (PowerShell):**
```powershell
npm --prefix frontend test
backend\.venv\Scripts\pip install pytest httpx
backend\.venv\Scripts\pytest backend -v
```

---

## Key Capabilities & Data Storage

- **Local SQLite Database**: Stored automatically at `data/planner.db` (WAL mode, auto-saved on every edit).
- **Checkpoints, Auto-Weekly Baselines & Visual Diff**: Save named milestone checkpoints with *Why-notes*, rely on automatic rolling weekly baselines (retaining the latest 12 weeks), and compare any checkpoint against the current plan via **Ghost Bars** on the Gantt chart and a **Delta Summary** table.
- **Local Snapshots**: One-click hot backups and restore stored in `data/backups/*.db`.
- **Unscheduled Backlog**: Capture upcoming projects before dates or people are known (`+ Backlog`), estimate rough effort in working days, and drag them onto any week column on the Gantt chart when capacity opens up.
- **TBD Demand Slots & "Who fits?"**: Add unassigned `TBD` roles on projects or phases and rank team members by real free capacity.
- **What-if Mode & Cascade Previews**: Experiment safely in an isolated sandbox and preview downstream Finish-to-Start schedule, deadline, and capacity impacts before applying.
- **Presentation Mode & Stakeholder Snapshots**: Toggle **Present** for a clean read-only view, or click **Snapshot** to export high-DPI PNGs, copy to clipboard, or print a 1-page Landscape PDF.
- **Lossless JSON & Excel CSV Portability**: Export/import complete plans via **Data** in the top bar.
