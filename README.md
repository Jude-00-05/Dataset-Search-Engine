# Dataset Search Engine

Dataset Search Engine is a multi-source dataset discovery platform built in the `Web Search Engine` repository. It combines a Python ingestion and indexing pipeline with a Node.js API and a React frontend so users can search, filter, and explore datasets from several public sources through one interface.

## Repository Purpose

This project is designed to:

- aggregate dataset metadata from multiple public providers
- normalize records into one consistent schema
- validate and clean the merged catalog
- build an inverted index for fast local search
- expose ranked search and catalog APIs
- provide a polished browser UI for exploration
- optionally run live "Deep Search" queries against source systems for fresh results

## Current Product Scope

The current implementation includes:

- indexed catalog search over generated local JSON data
- filter support for source, format, and task type
- weighted ranking tuned for dataset discovery intent
- live deep-search requests for broader source coverage
- data quality scripts for validation and link checking
- a legacy Python prototype kept in the repo for reference

## Tech Stack

- Frontend: React
- API: Node.js + Express
- Data pipeline: Python
- Storage: generated JSON artifacts in `data/`

## High-Level Architecture

1. Python source adapters fetch dataset metadata from Hugging Face, UCI, Kaggle, Data.gov, and GitHub.
2. The pipeline validates, deduplicates, and normalizes records into `data/merged_datasets.json`.
3. The index builder creates `data/inverted_index.json` for search-time retrieval.
4. The Node API reads those generated files directly and serves ranked search responses.
5. The React frontend calls the API and renders search, filters, and result cards.
6. Optional Deep Search bypasses the local index and queries live external sources at request time.

More detail lives in [docs/ARCHITECTURE.md](/c:/Projects/Web%20Search%20Engine/docs/ARCHITECTURE.md).

## Repository Layout

```text
Web Search Engine/
|-- backend/               Node API and live deep-search integrations
|-- crawler/               Legacy crawling utilities
|-- data/                  Seeded and generated catalog/index artifacts
|-- docs/                  Repository documentation
|-- frontend/              React application
|-- scripts/               Pipeline orchestration and maintenance scripts
|-- search/                Legacy Python search prototype
|-- search_engine/         Legacy Flask/Node experiment code
|-- sources/               Dataset source adapters and validation helpers
|-- .env.example
|-- CONTRIBUTING.md
`-- README.md
```

## Supported Sources

- Hugging Face
- UCI Machine Learning Repository
- Kaggle
- Data.gov
- GitHub repositories with dataset signals

Some adapters work with graceful fallbacks or partial coverage when credentials or network access are limited. Deep Search coverage is intentionally broader but less controlled than the curated local index.

## Search Experience

The indexed search flow prioritizes:

- title matches
- tags
- task types
- descriptions
- formats

The API also applies:

- phrase boosts
- source trust weighting
- intent expansions for specific query themes
- penalties for weak or mismatched results

This makes the local search experience stronger than a plain keyword lookup while staying easy to operate from flat files.

## API Summary

The primary API lives in `backend/server.js`.

- `GET /api/health`
- `GET /api/search?q=...`
- `GET /api/datasets?page=1&limit=12`
- `GET /api/sources`
- `GET /api/deep-search?q=...`
- `POST /api/reload`

## Quick Start

### 1. Install frontend dependencies

```bash
cd frontend
npm install
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Install Python dependencies

```bash
pip install nltk huggingface_hub ucimlrepo
```

Optional environment variables:

- `PORT`
- `KAGGLE_USERNAME`
- `KAGGLE_KEY`
- `GITHUB_TOKEN`

Start from [.env.example](/c:/Projects/Web%20Search%20Engine/.env.example).

### 4. Run the backend

```bash
cd backend
npm start
```

### 5. Run the frontend

```bash
cd frontend
npm start
```

The React app uses a development proxy to `http://localhost:3001`.

## Data Pipeline Commands

Fetch, clean, and merge data:

```bash
python scripts/fetch_all.py
```

Validate merged datasets:

```bash
python scripts/validate_datasets.py
```

Check dataset links:

```bash
python scripts/check_links.py
```

Build the inverted index:

```bash
python scripts/build_index.py
```

Run the full rebuild flow:

```bash
python scripts/rebuild_pipeline.py
```

## Generated Artifacts

Common generated files in `data/`:

- `merged_datasets.json`
- `inverted_index.json`
- `fetch_report.json`
- `validation_report.json`
- `link_check_report.json`
- `index_report.json`

These artifacts are environment-dependent. Counts may differ between runs depending on network access, third-party API behavior, credentials, and validation outcomes.

## Legacy Areas

The repository contains older prototype code in `search/`, `search_engine/`, and parts of `crawler/`.

For active development, treat these as reference or historical implementation paths unless you are explicitly reviving them. The current product path is:

- `frontend/`
- `backend/`
- `scripts/`
- `sources/`
- `data/`


