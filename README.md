<img src="public/favicon.svg" width="64" alt="">

# Excalidraw, self-hosted

The open-source [Excalidraw](https://github.com/excalidraw/excalidraw) editor with a small Node
server around it, for people and AI agents working on the same boards:

- boards are plain `.excalidraw` files in `data/`;
- several browser tabs and agents edit one board at once: the server merges changes element by
  element by `version` (the rule Excalidraw's own collaboration uses) and pushes them to every
  open tab over Server-Sent Events;
- an HTTP API to list, create, read and edit boards;
- slides (frames) export to a vector PDF or PNG;
- a presenter view for screen sharing, with a main deck and every other slide one keypress away.

## Run

```bash
npm install
npx playwright install chromium   # used by the PDF and PNG export
npm run build
openssl rand -hex 8 > data/password
npm start                         # http://localhost:3010, Basic auth with any login and that password
```

`deploy/excalidraw.service` is a systemd unit for running it permanently, and
`deploy/traefik.yaml` publishes it over HTTPS through Traefik. `HOSTS` (comma-separated, default
`0.0.0.0`) sets the addresses the server listens on.

## API

All endpoints take `?file=<name>.excalidraw`.

| Request | What it does |
| --- | --- |
| `GET /api/boards` | Boards with slide count and last change |
| `POST /api/boards` `{"name"}` | Creates an empty board |
| `GET /api/scene` | Full scene JSON; with `&lite=1`, images without their data |
| `GET /api/file?id=<fileId>` | One image of the board, cached by the browser for a year |
| `POST /api/scene` `{"elements", "files"}` | Merges changed elements (what the editor sends) |
| `POST /api/edit` `{"add", "update", "delete"}` | Edits for scripts and agents: patches by id, new elements with defaults filled in |
| `GET /api/events` | Server-Sent Events: `elements` with merged changes, `reload` after the file changed on disk |
| `GET /api/pdf` | PDF of the board's deck |
| `GET /api/shares` | The board's share link `{token, mode, created}` or `null`; without `file`, all of them by board |
| `POST /api/shares` `{"mode", "renew"}` | Creates the link or changes its `mode` (`view` or `edit`); `renew: true` replaces the token |
| `DELETE /api/shares` | Revokes the link |

## Sharing a board by link

"Поделиться ссылкой…" in the board menu gives the board a secret link `/s/<token>` (192 random
bits), view-only or editable. It opens that board without the password and nothing else: the page
calls the API with `?share=<token>` instead of `?file=`, the server takes the board from the token
and allows only reading it, its images and live changes, plus merging edits when the link is
editable. A board has at most one link; revoking or renewing it, or changing its mode, takes
effect at once, and tabs opened by the old link reload. Links live in `data/shares.json`.

`npm run pdf -- <file> [out.pdf] [--deck=<name>]` and `npm run shot -- <file> <slide> [out.png]`
export from the command line. `skill/excalidraw/SKILL.md` is an agent skill describing all of
this; link it into your agent's skills directory.

## Presenter view

`/present?file=<file>`: ← → move through the deck, G opens a grid of the deck and the remaining
slides, a click shows any slide, Esc returns to the deck, F toggles fullscreen. The deck is
`data/<board>.deck.json`: `{"row": 1, "dropLast": 3}` (the board's first row of frames, live) or
`{"slides": [frameId, …]}`. Variants live in `data/<board>.<name>.deck.json` and open with
`&deck=<name>`.
