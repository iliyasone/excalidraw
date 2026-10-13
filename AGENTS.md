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

- Show in Google Meet: http://212.118.40.237:3010/present?file=<name>.excalidraw (also ☰ → «Показ»).
  Ilias shares that tab. ← → page through the deck, G opens a grid with the deck plus the
  «Запас» section (every other frame), clicking a spare slide shows it, Esc returns to where he
  was, F is fullscreen. The tab picks up file changes live.
- The deck = `data/<name>.deck.json`. `{"row": 1, "dropLast": 3}` means the board's first row as
  it is right now, without the last three, so it follows Ilias as he drags frames around. An
  explicit list is `{"slides": [frameId, …]}`. Rows and order come from `src/deck.js`. Extra
  variants live in `data/<name>.<deck>.deck.json` and open with `&deck=<deck>` (PDF:
  `--deck=<deck>`). Ilias trims the presentation by talking to you: change the deck, never
  delete frames, since dropped slides stay in «Запас». No file = every frame.
- PDF: `npm run pdf -- <name>.excalidraw` → `data/<name>.pdf` (vector, fonts embedded, ~20 s); with a deck, only
  the deck's slides.
  In the browser: ☰ menu → «Слайды в PDF».
- Look at a slide: `npm run shot -- <name>.excalidraw <number or frame name> [out.png]` → 2x PNG.
  Check every slide you edit this way before reporting.
- Build and send the PDF only when Ilias asks. Send it to him in Telegram as a file, not as a link:
  `curl -F chat_id=… -F document=@data/<name>.pdf https://api.telegram.org/bot…/sendDocument`
  with the bot from `~/.config/claude-telegram/env` (the same bot as the `tg-notify` skill).

## Editing the board

The server holds every board in memory and merges edits element by element by `version`, the same
rule Excalidraw uses in live collaboration (higher `version` wins; on a tie, the lower
`versionNonce` wins). Open tabs and agents send only the elements they changed, so simultaneous
edits from Ilias and from you don't overwrite each other.

Edit through HTTP, not by writing the file. Basic auth with any login and the password from the
file:

```bash
AUTH="a:$(cat /root/.config/excalidraw-local/password)"
curl -s -u "$AUTH" 'localhost:3010/api/scene?file=parallel.excalidraw' > /tmp/scene.json   # read
curl -s -u "$AUTH" 'localhost:3010/api/edit?file=parallel.excalidraw' -d '{
  "update": [{"id": "<id>", "x": 120, "text": "новый текст"}],
  "add": [{"type": "text", "x": 0, "y": 0, "text": "…", "fontSize": 20, "fontFamily": 5, "frameId": "<frame id>", …}],
  "delete": ["<id>"]
}'
```

- `update` is a patch over the current element. The server bumps `version`, and for text it also
  sets `originalText`. If the text length changes, pass a new `width` yourself (Excalifont is
  about 0.56·fontSize per character).
- `add` takes the element's own fields. `id`, `seed`, `version`, `index` and the common defaults
  are filled in by the server. Copy the shape of a similar existing element.
- `delete` marks the element `isDeleted` (Excalidraw keeps tombstones so deletions sync).
- In the scene JSON, skip elements with `isDeleted: true`.
- A slide's content carries `frameId` = the frame's id; coordinates are absolute on the canvas.
- Text inside a shape: the text has `containerId`, and the shape has
  `boundElements: [{"type": "text", "id": …}]`.
- Images: the element is `type: "image"` with a `fileId`; pass the data next to it as
  `"files": {"<fileId>": {"id", "mimeType", "dataURL", "created"}}`.
- Writing `data/<name>.excalidraw` directly still works as a last resort: the server rereads it and
  reloads every tab, but an edit Ilias is making in that second is lost.

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
