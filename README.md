# FitVerify AI Portal

FitVerify AI Portal is a React + TypeScript + Vite prototype for collecting, OCR-scanning, and approving employee fitness activity evidence.

The app currently supports:

- Employee activity submission with image upload
- Client-side OCR with Tesseract.js
- Duplicate image detection with SHA-256 hashing
- Date validation from OCR text
- LocalStorage mock database mode
- Optional Supabase integration for employees, submissions, and evidence image storage
- Company dashboard, leaderboard, admin approval queue, and system spec view

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Tesseract.js
- Supabase JavaScript client
- Oxlint

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

Build for production:

```bash
npm run build
```

Run lint:

```bash
npm run lint
```

## Environment Variables

The app works without Supabase by falling back to LocalStorage mock mode.

To enable Supabase, copy `.env.example` to `.env` and fill in:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Do not commit `.env`.

## Supabase Tables

The frontend expects these tables when Supabase is configured:

- `employees`
- `submissions`

The app also attempts to upload base64 evidence images to the `fitverify_evidence` storage bucket.

## Project Structure

```text
fitverify-portal/
  public/              Static public assets
  src/
    App.tsx            Main application prototype
    dbService.ts       Supabase and LocalStorage data service
    main.tsx           React entry point
    index.css          Global styles
  .env.example         Environment variable template
  .gitignore           Git ignore rules
  package.json         Scripts and dependencies
```

## Git Notes

This repository should track source files, config files, public assets, and `package-lock.json`.

Generated or machine-local files are ignored:

- `node_modules/`
- `dist/`
- `.env`
- logs
- coverage output

## Current Status

The project builds and lints successfully as of the current baseline:

```bash
npm run build
npm run lint
```
