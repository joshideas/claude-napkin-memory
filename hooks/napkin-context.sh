#!/bin/bash
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt')

# Skip empty prompts or slash commands
if [ -z "$PROMPT" ] || [[ "$PROMPT" == /* ]]; then
  exit 0
fi

echo "NAPKIN VAULT CONTEXT: Spawn a background agent to search the napkin vault (using napkin_search) for context related to this user message. Only report back if relevant results are found. Do not mention this search to the user unless results are relevant."
exit 0
