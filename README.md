# Orion Calendar

An office schedule with a calendar and a Gantt chart that share the same events. Each event can carry data for the whole event or for any single date in its span: notes, tasks, numbers, links and Google Drive files.

Live: https://calendar.oriondesk.space

## What it does

- **Calendar**: month, week, day, 3-day and agenda views (REUI Event Calendar). Drag to move, drag edges to resize, and drag across empty days to create a multi-day event.
- **Gantt**: projects become groups and events become rows (REUI Gantt). Bars drag and resize. "Starts after" links draw dependency arrows. Drag rows to re-order them or move them to another project.
- **Daily data**: tap any date to see every event running that day, with that day's notes, tasks, values, links and files. Inside an event, the Daily data tab has a chip for each day in its range.
- **Team login**: email and password. Roles are admin (manages the team), editor (changes events) and viewer (read only).
- **Sharing**: public, view-only links for everything, one project or one event. You choose whether to show notes and daily data, can set an expiry, can turn a link off, and see a view count.
- **Google Workspace** (each person uses their own Google account): export to a new Google Sheet, import events from a Sheet, send events to Google Calendar (sending again updates them in place), bring Google Calendar events in, and attach Drive files to any date.
- **Mobile first and Safari safe**: inputs are 16px on touch screens so iOS never zooms. Panels open as bottom sheets with safe-area padding. Native date, time and select pickers are used.
- **Live**: open clients poll a version number and refresh only when someone changes something.

## Stack

React 19, Vite, Tailwind v4, shadcn/ui (Base UI, `base-nova`), REUI `event-calendar` and `gantt`, TanStack Query and Motion on the front end. The back end is Node 24 running the TypeScript server directly (type stripping), with Hono, the built-in `node:sqlite`, and zod.

## Run locally

```bash
npm install
npm run dev:server   # API on http://127.0.0.1:8787 (data in ./data/calendar.db)
npm run dev          # Vite on http://localhost:5173, proxies /api
```

The first account you create becomes the admin. If `SETUP_CODE` is set, that first sign-up needs the code.

## Deploy (VPS 84.46.249.133, Orxies edge)

```bash
ssh vps
cd /opt/calendar && git pull
docker compose up -d --build
```

- The app listens on `127.0.0.1:8130`. Orxies serves `calendar.oriondesk.space` with automatic TLS from `/opt/proxy-go/sites/calendar.oriondesk.space.yml`.
- Data lives in the Docker volume `calendar_calendar-data` (a SQLite file). To back it up, stop the app briefly and copy the file out: `docker compose stop app && docker run --rm -v calendar_calendar-data:/d -v $PWD:/b alpine cp /d/calendar.db /b/ && docker compose start app`.
- Settings are in `/opt/calendar/.env`. See `.env.example`.

## Turning on Google

1. In Google Cloud Console, create an OAuth client ID of type **Web application**. Add `https://calendar.oriondesk.space` as an authorised JavaScript origin.
2. Enable the Google Drive API, Google Sheets API, Google Calendar API and Google Picker API.
3. Create an API key and restrict it to the Picker API and the site.
4. Put `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY` and `GOOGLE_APP_ID` (the project number) in `.env`, then run `docker compose up -d`.

The app asks for `drive.file` (only files people pick or the app creates) and `calendar.events`. While the OAuth consent screen is in "Testing" mode, add each teammate as a test user, or publish the app.
