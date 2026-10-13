---
name: excalidraw
description: Work on Excalidraw boards and slide decks hosted on this machine's own Excalidraw server — read a board, add, change or delete shapes and text, create a board, render slides to PNG or PDF, set which slides a presentation shows. Use whenever asked to draw, edit or present something "in Excalidraw", or to work on a board, diagram or deck there.
---

# Excalidraw on this machine

The server lives in `/root/excalidraw` (systemd unit `excalidraw`) and listens on `localhost:3010`;
people open it at https://excalidraw.sheetlife.app (the home page lists all boards).
Boards are `data/<name>.excalidraw` files in that repo. A person may have the same board open in a
browser at the same time as you: the server merges edits element by element by `version`, so go
through the HTTP API and never write the board file yourself.

Auth is HTTP Basic with any login and the password from `/root/excalidraw/data/password`:

```bash
AUTH="agent:$(cat /root/excalidraw/data/password)"
B='localhost:3010'
curl -s -u "$AUTH" "$B/api/boards"                                   # list boards
curl -s -u "$AUTH" "$B/api/boards" -d '{"name": "Roadmap"}'          # create → {"file": "Roadmap.excalidraw"}
curl -s -u "$AUTH" "$B/api/scene?file=Roadmap.excalidraw"            # full scene JSON
curl -s -u "$AUTH" "$B/api/edit?file=Roadmap.excalidraw" -d '{"add": [...], "update": [...], "delete": [...]}'
```

URL-encode `file` in API URLs when the name has spaces or non-Latin letters.

`/api/edit`:
- `add`: Excalidraw element objects. The server fills `id`, `seed`, `version`, `versionNonce`,
  `index`, style defaults and, for text, font, alignment, `originalText` and an estimated
  `width`/`height`; returns the new ids. Copy the shape of a similar element
  from the scene. Images also need `"files": {"<fileId>": {"id", "mimeType", "dataURL", "created"}}`
  in the body.
- `update`: `{"id": …, <changed fields>}` patches. The server bumps `version`; for text it also sets
  `originalText` and re-estimates `width`/`height` unless you send them.
- `delete`: ids. They stay in the scene as `isDeleted: true`; skip those when reading.

## Slides

A frame is a slide; slide content has `frameId` set to it. Coordinates are absolute on the canvas.
Slide order is rows top to bottom (a frame starts a new row when it sits lower than half a frame
height below the row's first frame), left to right within a row.

- Render a slide to check your work: `cd /root/excalidraw && npm run shot -- <file> <slide> /tmp/out.png`,
  where `<slide>` is a frame name or its 1-based number in board order.
- PDF: `npm run pdf -- <file> [out.pdf] [--deck=<name>]`, one vector page per slide.
- Presenting: `https://excalidraw.sheetlife.app/present?file=<file>`; arrows page through the deck, G
  shows every slide including the ones outside the deck.
- The deck is a small JSON file you write directly next to the board:
  `data/<board>.deck.json`, or `data/<board>.<name>.deck.json` opened with `&deck=<name>`.
  `{"row": 1, "dropLast": 3}` follows the board's rows live (`row` is 1-based); `{"slides": [frameId, …]}`
  lists frames explicitly. No deck file = every frame. Open presenter tabs pick up deck changes.
