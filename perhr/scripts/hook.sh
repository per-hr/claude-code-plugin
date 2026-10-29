#!/usr/bin/env bash
# per.hr plugin: sends one Claude Code hook event to per.hr. Only the event (session id, event
# name, subagent id) plus the repo's remote, folder name and branch are sent: never prompts, code
# or file contents. per.hr records nothing for repos you haven't connected there.
# The reply is printed only for SessionStart, where Claude Code shows it to Claude as context.

KEY="${CLAUDE_PLUGIN_OPTION_API_KEY:-${CLAUDE_PLUGIN_OPTION_api_key:-}}"
SERVER="${CLAUDE_PLUGIN_OPTION_SERVER:-${CLAUDE_PLUGIN_OPTION_server:-https://per.hr}}"
SERVER="${SERVER%/}"
[ -z "$KEY" ] && exit 0
command -v curl >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
# Keep only the fields per.hr uses, so nothing else (like a prompt) ever leaves the computer
field() { printf '%s' "$INPUT" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1; }
EVENT="$(field hook_event_name)"
SESSION="$(field session_id)"
AGENT="$(field agent_id)"
[ -z "$EVENT" ] || [ -z "$SESSION" ] && exit 0

DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
TOP="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$DIR")"
REMOTE="$(git -C "$DIR" remote get-url origin 2>/dev/null || true)"
BRANCH="$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
[ "$BRANCH" = "HEAD" ] && BRANCH=""
FOLDER="$(basename "$TOP")"

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'; }
BODY="{\"tool\":\"claude-code\",\"remote\":\"$(esc "$REMOTE")\",\"folder\":\"$(esc "$FOLDER")\",\"branch\":\"$(esc "$BRANCH")\",\"event\":{\"session_id\":\"$(esc "$SESSION")\",\"hook_event_name\":\"$(esc "$EVENT")\",\"agent_id\":\"$(esc "$AGENT")\"}}"

# For the perhr command (/perhr:start, status, pause, resume, done): the key, and this repo's session
STATE="$HOME/.perhr"
mkdir -p "$STATE/sessions" 2>/dev/null && chmod 700 "$STATE" 2>/dev/null
if [ "$EVENT" = "SessionStart" ]; then
  umask 077
  printf 'SERVER=%s\nKEY=%s\n' "$SERVER" "$KEY" > "$STATE/config"
  printf '%s' "$SESSION" > "$STATE/sessions/$(printf '%s' "$TOP" | cksum | cut -d' ' -f1)"
fi

REPLY="$(printf '%s' "$BODY" | curl -s -m 8 -X POST "$SERVER/api/agent/hooks" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" --data-binary @- 2>/dev/null || true)"
[ "$EVENT" = "SessionStart" ] && [ -n "$REPLY" ] && printf '%s\n' "$REPLY"
exit 0
