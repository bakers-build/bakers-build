# ---------------------------------------------------------------------------
# scenes.sh — THE DESIGNBOOK SCENE PARSER. Sourced, never run.
#
#   . "$(dirname "${BASH_SOURCE[0]}")/lib/scenes.sh"
#   model="$(scene_model "$scenes_file")"
#   for idx in $(scene_indices "$model"); do
#     name="$(scene_name_of "$model" "$idx")"
#     scene_lines "$scenes_file" "$model" "$idx" | grep …
#   done
#
# layout-components.sh sources it; a check that must assert inside ONE scene's
# own line range rather than across a 2 000-line file uses it instead of its own
# copy, because a parser copied is a parser that drifts.
#
# It is under `lib/` and not beside the gates on purpose: a helper at the
# `tests/contract/*.sh` level would read as a gate.
# ---------------------------------------------------------------------------

# --- The scene model ----------------------------------------------------------------------------
#
# Every assertion about a scene is an assertion about STRUCTURE — which node opens the scene, what
# sits directly in the `content` slot, how many page headers a screen places. A grep cannot answer
# any of those: `component: bb_theme:canvas` appearing somewhere in a 2 160-line file says nothing
# about whether it is the single direct child of `content` or the fourth item inside a table body.
#
# So parse. For each scene in a scenes file, print TSV records:
#
#     <idx> <TAB> <name> <TAB> LINES   <TAB> <first-line>:<last-line>
#     <idx> <TAB> <name> <TAB> ITEM1   <TAB> <text of the first sequence entry under `items:`>
#     <idx> <TAB> <name> <TAB> CONTENT <TAB> <inline value after the `content:` key, "" if a block>
#     <idx> <TAB> <name> <TAB> CHILD   <TAB> <text of each DIRECT sequence child of `content:`>
#
# A scene starts at a `- name:` list item at indent 2 (the `scenes:` sequence) and runs to the line
# before the next one. `content:` is the SHALLOWEST such key inside the first item, which is the
# shell's own content slot — a `zone`'s `content` slot nests deeper and must not be mistaken for it.
# Block scalars (`docs: >-`, `description: |`) are skipped wholesale: their prose is free text that
# may contain anything, including something that looks like a YAML key.
scene_model() {
  awk '
    function ind(s) { match(s, /^ */); return RLENGTH }
    function flush() {
      if (idx > 0) { printf "%d\t%s\tLINES\t%d:%d\n", idx, name, start, last }
    }
    { line = $0; sub(/\r$/, "", line) }
    {
      if (blk >= 0) {
        if (line ~ /^[ \t]*$/) { next }
        if (ind(line) > blk) { next }
        blk = -1
      }
    }
    line ~ /^[ \t]*$/ { next }
    {
      i = ind(line)
      body = substr(line, i + 1)
      if (body ~ /^#/) { next }
      # A key (or sequence entry) that opens a block scalar. Recorded here so the key line itself is
      # still processed normally, while everything indented under it is skipped.
      if (body ~ /:[ \t]*[|>][0-9]*[-+]?$/ || body ~ /^-[ \t]*[|>][0-9]*[-+]?$/) { blk = i }

      if (i == 2 && body ~ /^- name: /) {
        flush()
        idx++
        name = body; sub(/^- name: /, "", name); gsub(/^["'"'"']|["'"'"']$/, "", name)
        start = NR; last = NR
        items_ind = -1; item1_ind = -1; content_ind = -1; child_ind = -1; content_closed = 0
        next
      }
      if (idx == 0) { next }
      last = NR

      if (items_ind < 0) {
        if (body ~ /^items:/) { items_ind = i }
        next
      }
      if (item1_ind < 0) {
        if (i > items_ind && body ~ /^- /) {
          item1_ind = i
          printf "%d\t%s\tITEM1\t%s\n", idx, name, substr(body, 3)
        }
        next
      }
      if (i <= item1_ind) { next }

      if (body ~ /^content:/ && (content_ind < 0 || i < content_ind)) {
        content_ind = i; child_ind = -1; content_closed = 0
        cval = body; sub(/^content:[ \t]*/, "", cval)
        printf "%d\t%s\tCONTENT\t%s\n", idx, name, cval
        next
      }
      if (content_ind >= 0 && !content_closed) {
        if (i <= content_ind) { content_closed = 1; next }
        if (body ~ /^- /) {
          if (child_ind < 0) { child_ind = i }
          if (i == child_ind) { printf "%d\t%s\tCHILD\t%s\n", idx, name, substr(body, 3) }
        }
      }
    }
    END { flush() }
  ' "$1"
}

# One field of the model, for one scene index.
model_field() {
  printf '%s\n' "$1" | awk -F'\t' -v idx="$2" -v kind="$3" '$1 == idx && $3 == kind { print $4 }'
}

scene_indices() {
  printf '%s\n' "$1" | awk -F'\t' 'NF > 1 { print $1 }' | sort -un
}

scene_name_of() {
  printf '%s\n' "$1" | awk -F'\t' -v idx="$2" '$1 == idx && $3 == "LINES" { print $2 }'
}

# The lines of one scene, so a per-scene textual count (A5, A10) counts inside the scene it is about
# rather than across the whole file.
scene_lines() {
  local file="$1" model="$2" idx="$3" range
  range="$(model_field "$model" "$idx" LINES)"
  [ -n "$range" ] || return 0
  sed -n "${range%%:*},${range##*:}p" "$file"
}

