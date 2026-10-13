# Pastes and drops arrive whole, and are read before they are shown

2026-10-13 · approved in conversation ("fix it then")

## Problem

A terminal cannot tell Forge a file was dropped; it types the file's path,
fast. Home guessed "drop" when more than one character arrived in a single
read onto an empty field. Two bugs came from that guess:

1. **Ghostty: the path stays in the field, no card.** If the path arrives in
   more than one read, the first piece fills the field and the rest is typed
   after it, so it is no longer read as a drop. (A `file://…` URL instead of a
   path would look the same; that is handled too, below.)
2. **The flash.** A recognised drop was let into the field while its file was
   read (≈50 ms cold), then cleared for the card: the path blinks in the field
   before the drop zone answers.

## Decisions

1. **Bracketed paste is on while a field is listening.** `useKeys(…, { pastes:
   true })` also registers Ink's `usePaste`, which turns on `?2004h`. The
   terminal then wraps every paste *and drop* in `ESC[200~ … ESC[201~`, and
   Ink holds it until the end marker, however many reads it takes. The paste
   reaches the same handler as typing, as one `input` with a key that has
   nothing pressed (`PASTE`), so every intercept that already reads a
   multi-character input as a paste keeps working unchanged.
   Takers: `Prompt` (every text field) and colour's home, whose field is not
   mounted until something is typed.
2. **Home reads a paste before anything is drawn.** On an empty field a
   paste that starts like a dropped path (`startsLikePath`: `/`, `~`, `.`,
   quoted, `file://`, a drive or share on Windows) is taken by `homeKey`, not
   shown. Words are typing and go straight in; nothing is held back that
   could not be a drop. If it names something on disk the
   card and ring play; if not it is put in the field as typed. A paste into a
   field that already holds text goes in at the caret, as before — so a path
   pasted to be edited is only ever read as a drop on an empty field, which
   was already true.
3. **Pieces are joined in terminals that don't bracket.** Text that arrives
   within `DROP_PIECE_MS` (100 ms) of the last piece is appended to it and
   the whole read again — until the paste lands as a drop, or ends in a line
   break: then it is over, and a key pressed is a key. Nobody types that fast after a paste.
4. **`file://` URLs are paths.** `unescapePath` turns `file:///Users/x/Id%20card.png`
   into `/Users/x/Id card.png`, so every field that takes a path takes one.
5. **The terminal is handed back with bracketed paste off** on every exit.
   Nothing to add: Ink unmounts through `signal-exit` on exit and on signals,
   and its unmount writes `?2004l` (checked: SIGTERM under `script` writes
   it after the `?2004h`).

## Not changed

- Screens with no text field still read pastes as typed input; with no
  listener Ink does not turn bracketed paste on there.
- A multi-line paste still submits at its first line break, as typing does.
