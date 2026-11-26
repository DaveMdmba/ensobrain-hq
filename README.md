# David x Dave HQ

Shared task board for David Amor (Ensobrain) and Dave: board, table, brain dump,
weekly numbers and routine checks. Every change shows up live for everyone signed in.

## How it works

- `server.js`: Node HTTP server (no framework). Serves the page, a JSON API, and a
  live-update stream (`/api/events`).
- `store.js`: Postgres storage (three tables, created automatically on first start).
- `public/`: the page itself.

## Settings (environment variables)

| Name | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Required. |
| `ACCESS_CODE` | The team passcode, 12+ characters (letters, numbers and hyphens). Whoever has it can open and edit the board. Set it yourself in the hosting dashboard. Changing it signs every device out. |
| `PORT` | Set by the host. |

## Getting in (no email, no password)

Each person opens a private link once; that device is then remembered for a year.

    https://<your-site>/#k=<ACCESS_CODE>&me=Dave
    https://<your-site>/#k=<ACCESS_CODE>&me=David

The part after `#` stays in the browser and is removed from the address bar right away.
Anyone who gets a link can open and edit the board, so share it privately. If a link
leaks, change `ACCESS_CODE` and send out new links.

## Run

    npm install
    npm start

Build command on Render: `npm install`. Start command: `npm start`. Health check path: `/healthz`.

## Security notes

- The passcode is the only key. Remembered devices hold a random token in an HttpOnly
  cookie (stored hashed), tied to the passcode in force when it was issued.
- Wrong passcode guesses are limited to 30 per hour in total.
- No client data lives in this repository; it is all in the database.
