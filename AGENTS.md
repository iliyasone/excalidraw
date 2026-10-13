# excalidraw-local

Ilias's presentations and boards, without Excalidraw+. The open-source Excalidraw editor runs on
this server: Ilias edits in the browser and agents edit the same file on disk. Both sides see
each other's changes live.

## Where things are

- Editor: http://212.118.40.237:3010/?file=<name>.excalidraw (default `parallel.excalidraw`).
  Basic auth with any login; the password is in `/root/.config/excalidraw-local/password`.
- Boards: `data/<name>.excalidraw`, plain Excalidraw JSON. `data/` is outside git because the
  boards hold business numbers.
- Service: systemd unit `excalidraw-local` (`deploy/excalidraw-local.service`, symlinked into
  `/etc/systemd/system`), starts on boot. After changing `src/` or `index.html`:
  `npm run build && systemctl restart excalidraw-local`.

## Slides

One frame = one slide. Order: rows top to bottom, left to right within a row (frames are laid out
on a grid with a 1000 px step along x).

- PDF: `npm run pdf -- <name>.excalidraw` → `data/<name>.pdf` (vector, fonts embedded, ~20 s).
  In the browser: ☰ menu → «Слайды в PDF».
- Look at a slide: `npm run shot -- <name>.excalidraw <number or frame name> [out.png]` → 2x PNG.
  Check every slide you edit this way before reporting.
- Send the finished PDF to Ilias in Telegram, don't make him download it:
  `curl -F chat_id=… -F document=@data/<name>.pdf https://api.telegram.org/bot…/sendDocument`
  with the bot from `~/.config/claude-telegram/env` (the same bot as the `tg-notify` skill).

## Editing the file

- Write the whole file (`type`, `version`, `elements`, `appState`, `files`). An open browser tab
  picks up the change within a second; edits from the tab land in the file about 0.6 s after
  the last stroke. Re-read the file right before writing so you don't wipe Ilias's edits.
- New element: copy a similar existing one, give it a new unique `id`, random `seed` and
  `versionNonce`, set `version: 1`. Changing an existing element: `version + 1`.
- A slide's content carries `frameId` = the frame's id; coordinates are absolute on the canvas.
- Text inside a shape: the text has `containerId`, and the shape has
  `boundElements: [{"type": "text", "id": …}]`.
- Images: the element is `type: "image"` with a `fileId`; the data sits in
  `files[fileId] = {id, mimeType, dataURL, created}`.

## Ilias's slide style

- 854×480 frames. The title is Excalifont (`fontFamily: 5`) at 44 px, placed at (40, 40) from
  the frame's corner. Text is Excalifont; numbers are monospace Cascadia (`fontFamily: 3`).
- Only what he asked for: no subtitle-descriptions, no grey footnotes.
- Progressive slides: the next frame repeats the previous one and adds the new part in blue
  `#1971c2`, while the earlier blue part turns black.

## Excalidraw+

The `parallel.excalidraw` board was downloaded from Excalidraw+ (scene `AZrBjDPWy0i`) on
13.10.2026; from then on the local file is the source of truth. `scripts/fetch-plus.sh
<sceneId> <out>` downloads a scene through the Excalidraw+ MCP API (personal key in
`/root/.config/excalidraw/personal-key`). It returns the raw MCP JSON-RPC response: the scene
is the JSON string inside `result.content[0].text`, deleted elements included. Opening the file
in the editor removes the deleted elements.
