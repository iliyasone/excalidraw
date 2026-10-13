#!/bin/bash
# Usage: fetch.sh <sceneId> <out.json>  — raw get_scene_content via Excalidraw+ MCP
KEY=$(cat /root/.config/excalidraw/personal-key)
U=https://api.excalidraw.com/api/v1/mcp
H=(-H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
SID=$(curl -s -D - -o /dev/null "${H[@]}" $U -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}' | grep -i mcp-session-id | awk '{print $2}' | tr -d '\r')
[ -n "$SID" ] && H+=(-H "mcp-session-id: $SID")
curl -s "${H[@]}" $U -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
curl -s "${H[@]}" $U -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_scene_content\",\"arguments\":{\"sceneId\":\"$1\"}}}" > "$2"
