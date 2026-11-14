# Orion Calendar

An office schedule with a calendar and a Gantt chart that share the same events. Each event can carry data for the whole event or for any single date in its span: notes, tasks, numbers, links and Google Drive files.

Live: https://calendar.oriondesk.space

## What it does

- **Calendar**: month, week, day, 3-day and agenda views (REUI Event Calendar). Drag to move, drag edges to resize, and drag across empty days to create a multi-day event.
- **Gantt**: projects become groups and events become rows (REUI Gantt). Bars drag and resize. "Starts after" links draw dependency arrows. Drag rows to re-order them or move them to another project.
- **Daily data**: tap any date to see every event running that day, with that day's notes, tasks, values, links and files. Inside an event, the Daily data tab has a chip for each day in its range.
- **Team login**: email and password. Roles are admin (manages the team), editor (changes events) and viewer (read only).
- **Sharing**: public, view-only links for everything, one project or one event. You choose whether to show notes and daily data, can set an expiry, can turn a link off, and see a view count.
- **Google Workspace**: Sheets export (each person uses their own Google account). Sheets import from a pasted link of a sheet shared "Anyone with the link", or from a CSV. Google Calendar: an "Add to Google Calendar" button per event, plus a calendar feed per share link that Google Calendar, Outlook or Apple Calendar can subscribe to. Import Google Calendar events from an exported .ics file. Drive, Docs and Sheets links can be attached to any date.
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

## Google setup (live)

- Google Cloud project `orion-calendar-514710` is **In production** with only non-sensitive scopes: `drive.file`, `openid`, `email` and `profile`. That is why Google shows no "unverified app" screen and no review is needed. Do not add sensitive scopes such as Calendar or reading all Sheets unless you also submit the app for Google verification.
- The OAuth client's authorised JavaScript origin is `https://calendar.oriondesk.space`. The API key is restricted to the Picker API on that site.
- Branding: home `/`, privacy `/privacy`, terms `/terms`, authorised domain `oriondesk.space`. Don't upload a logo: that would require verification.
- Server `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY` and `GOOGLE_APP_ID` (the project number).
- The Drive Picker needs third-party cookies, so it is only offered in Chrome and Edge. Pasting links works everywhere.
