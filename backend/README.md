# Sentinel Backend

FastAPI backend for member 2: API, database, source upload, issues, fix proposals, versions, rollback, and test result storage.

## Local run

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

For quick local development without MySQL, set:

```text
DATABASE_URL=sqlite:///./sentinel.db
```

## MySQL URL

```text
DATABASE_URL=mysql+pymysql://USER:PASSWORD@HOST:3306/DATABASE
```

## Main endpoints

The backend exposes both `/...` and `/api/...` paths so it works with the frontend README and the original member-2 plan.

```text
GET  /api/health
GET  /api/projects
POST /api/projects
POST /api/projects/{id}/upload
POST /api/projects/{id}/scan
GET  /api/projects/{id}/files
GET  /api/projects/{id}/files/content?path=app/auth/login.py
GET  /api/projects/{id}/issues
GET  /api/issues/{id}
GET  /api/issues/{id}/proposal
POST /api/issues/{id}/accept
POST /api/issues/{id}/reject
POST /api/projects/{id}/apply
POST /api/projects/{id}/test
GET  /api/projects/{id}/test-runs
GET  /api/projects/{id}/versions
POST /api/projects/{id}/rollback
```

Demo project `prj_001` is seeded by default.

