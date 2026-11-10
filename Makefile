.PHONY: up down seed api web dev reset psql check

up:            ## start PostgreSQL (first run also creates schema + roles)
	docker compose up -d --wait

down:
	docker compose down

seed:          ## import both CSVs from data/ with COPY
	cd api && .venv/bin/python scripts/seed.py

install:
	cd api && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
	cd web && npm install

api:
	cd api && .venv/bin/uvicorn app.main:app --reload --port 8000

web:
	cd web && npm run dev

check:         ## typecheck the frontend, import-check the backend
	cd web && npm run typecheck
	cd api && .venv/bin/python -c "import app.main"

psql:
	docker exec -it asml-db psql -U postgres -d copilot

reset:         ## drop the volume and rebuild from scratch
	docker compose down -v && docker compose up -d --wait && $(MAKE) seed
