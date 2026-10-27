# Working on this repo

Using the boards (API, slides, decks) is described in `skill/excalidraw/SKILL.md`; this file is
about changing the server and the frontend.

- `server.mjs`: HTTP server. Keeps each opened board in memory (`Scene`), merges incoming
  elements with Excalidraw's rule (higher `version` wins; on a tie, lower `versionNonce`),
  broadcasts merged changes to every other tab over SSE, writes the board back to `data/` 300 ms
  after the last change. Deleted elements are kept as `isDeleted` tombstones; dropping them would
  let a stale tab bring them back.
- `src/main.jsx`: the editor. Sends only elements whose `version` the server hasn't seen and
  merges incoming ones with `reconcileElements`, so a remote change never overwrites a local
  edit in progress.
- Sharing by link: `/s/<token>` and API calls with `?share=<token>` skip the password but reach only
  the token's board (`shareAllows` in `server.mjs` lists what they may do); tokens are in
  `data/shares.json`. `src/access.js` builds the board part of API URLs for both modes,
  `src/share.jsx` is the owner's dialog.
- `src/present.jsx`: presenter view; `src/home.jsx`: board list; `src/deck.js`: slide order and
  decks, shared by the browser and the export scripts.
- `scripts/`: PDF and PNG export through headless Chromium (Playwright) that opens the real
  editor and calls `exportToSvg`.

On this machine the server runs as the systemd unit `excalidraw` (`deploy/excalidraw.service`,
linked into `/etc/systemd/system`), listening only on localhost and `docker0`. The public address
https://excalidraw.sheetlife.app goes through the Coolify Traefik proxy: `deploy/traefik.yaml` is
a copy of `/data/coolify/proxy/dynamic/excalidraw.yaml`, the DNS record is in Cloudflare. After changing `src/` or `index.html`: `npm run build`; after
changing `server.mjs`: `systemctl restart excalidraw`. Open tabs keep working across a restart.

`data/` holds the boards and the password and is not in git.
