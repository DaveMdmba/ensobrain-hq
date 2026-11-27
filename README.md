# David x Dave HQ

Shared task board for David Amor (Ensobrain) and Dave: board, table, brain dump,
weekly numbers and routine checks. Every change shows up live for everyone signed in.

## Docs (reports, check-in notes, how-tos, decisions)

The Docs view keeps written updates in one place. Docs are rows in `hq_items` with
`kind = 'docs'`. Fields: `type` (report / checkin / sop / decision / note), `title`,
`period` (the week's Monday, for reports), `status` (draft / approved), `body` (Markdown:
`#` headings, `-` bullets, `**bold**`, `| tables |`, `>` callouts), `whatsapp` (short
message for David), `checks` (notes for Dave before approving), `nums` (JSON string with
`dms`, `calls`, `held`, `won`), plus `created`, `updated`, `approvedAt`, `approvedBy`,
`seenAt`, `reaction`, `feedback`, `feedbackAt`, `archived`.

- Drafts are only sent to Dave's devices; David never receives them, nor any `checks`.
- Approving (Dave only) shares the doc with David, saves the week's numbers with it,
  and copies a WhatsApp message with a link to the doc.
- David can open shared docs, give a thumbs-up and reply; he can't edit or delete them.
- "Download PDF" prints just the branded page.
- A scheduled task can add a draft by inserting a `docs` row directly in the database;
  open pages pick it up within two minutes.

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
