# Testing Convert on an Intel Mac

Thanks for helping. This takes about an hour, and you can stop after any
part and send what you have. Do the steps in order. Write down anything that
looks odd, even if it still worked.

Forge has only been run by hand on Apple-silicon Macs. An Intel Mac is a
different case in a few places (no Apple speech engine, no Boost, the
programs inside Forge are built for Intel). Those are marked **Intel:** below.

Each step says what to do, then **Right:** what you should see. If you see
something else, that is what we want to hear about. See "What to send back"
at the end.

> **For whoever sends the build.** From the branch: `npm run build`, then
> `npm pack`. That makes `forge-terminal-<version>.tgz`; send that file. The
> tester installs it with the command in "Before you start".

## Files to have ready

You do not need all of these. Use what you have.

- a JPG and a PNG (a screenshot is fine)
- a HEIC photo from an iPhone, a camera RAW photo (`.CR2`, `.NEF`, `.ARW`, `.DNG`...)
- a PDF and a Word file (`.docx`)
- a video or sound file with someone talking, one or two minutes long
- a scanned page or a photo of a printed page (for reading text)

## Before you start

1. Note your Mac: Apple menu › About This Mac. Write down the macOS version,
   the model and year, and the processor (it should say Intel).
2. Install Node.js 20 or newer: `brew install node`, or the installer from nodejs.org.
   (No Homebrew? Get it from brew.sh; you will want it for ffmpeg.)
3. Install Convert:
   - from the internet: `npm i -g forge-terminal`
   - from a file you were sent: `npm i -g ./forge-terminal-<version>.tgz`
4. `forge --version`. **Right:** it prints the version you were told to expect.
5. In Terminal, type `uname -m`. **Right:** `x86_64`.

## 1. First start

1. `forge`, then Enter. **Right:** a home screen with tabs along the top
   (convert, compress, pdf, edit, transcribe, colour) and a box that says to drop
   a file. The first time it asks light or dark; pick one.
2. **Right:** once, it says it added itself to Finder's Quick Actions.
3. Type `/`. **Right:** a list of commands opens. Press Esc to close it.
4. Press Ctrl+C to quit.

## 2. Convert, compress, edit

Type `forge`, then drag a file onto the window, then Enter.

1. Convert a JPG to PNG. **Right:** you pick a format, then a folder, then see
   a "done" screen with the before and after sizes.
2. On the done screen press `o` (opens the file), then `f`. **Right:** Finder opens
   with the new file selected.
3. Convert the PNG to WebP, and a PNG to AVIF. **Intel:** AVIF is the slowest
   format; note roughly how long a normal photo takes.
4. Press `2` (compress) on the home screen and compress a JPG with the slider.
   **Right:** the new file is smaller and still looks fine.
5. From the command line: `forge photo.jpg --max-size 300kb`. **Right:** a
   smaller `photo-small.jpg` next to the original.
6. Press `4` (edit) with a photo. Try **Resize**, **Rotate** and **Crop to shape**.
   **Right:** each makes a new file; a rotated photo is the right way up.
7. Press `3` (pdf) with a PDF: merge two, or split one. Also convert a PDF to
   images, and an image to a PDF.
8. Convert a Word file to PDF. It is fine if you do not have LibreOffice;
   note whether you do.
9. **Intel:** in edit mode, look for **Boost resolution**. **Right:** it is not
   offered, or it says plainly that there is no build for this Mac. It must not
   start and then sit there. (A graphics-card version may come later.)
10. **Remove background** (edit mode, a photo of a person or an object). It
    needs macOS 14 or newer and a small extension (32 KB).
    **Right:** the offer to install it, then a cut-out PNG. Note how long it
    took, and whether the edges look right.

## 3. HEIC and RAW

macOS opens these itself, so there is nothing to install.

1. Convert a HEIC photo to JPG. **Right:** it just works, and a portrait photo
   is upright.
2. If you have a RAW photo: convert it to JPG. **Right:** it works, upright,
   without installing anything.

## 4. Pasting a picture

1. Copy a picture: press Control+Shift+Command+4 and select an area (this puts
   it on the clipboard instead of saving a file), or right-click a picture in
   your browser and choose "Copy Image". Do not copy a file.
2. In Forge's home screen press **⌘V**. **Right:** a card named "Copied image".
   (If nothing happens in your terminal, Ctrl+V does the same.)
3. Choose compress. **Right:** no "Save as" question; the result goes back on
   the clipboard.
4. Paste into Messages, Notes or Preview (⌘V). **Right:** the smaller picture appears.
5. Back in Forge, `u` on the done screen puts the original back.
6. From the command line: copy a picture, then `forge clip`.

## 5. Finder's Quick Actions and presets

1. Right-click a JPG in Finder, then **Quick Actions**. **Right:** Open Forge,
   Convert in Forge, Compress in Forge (and Sharpen in Forge only if Boost is installed,
   which it cannot be here). If you do not see them, try **Customize…** at the
   bottom of that menu.
2. Choose **Convert in Forge**. **Right:** a terminal window opens with that file ready.
3. Right-click a PDF. **Right:** an **Open in Forge** Quick Action.
4. Make a preset: convert a photo to WebP, and on the done screen press `p`.
   Give it a name.
5. Type `/right-click`. **Right:** a line saying Forge is in Finder's Quick
   Actions, and a line "0 of 1 presets in Quick Actions". Press Enter on it
   and turn your preset on.
6. Right-click another JPG › Quick Actions. **Right:** your preset is there.
   Choose it. **Right:** no window; a new WebP appears next to the photo,
   and a notification appears.
7. Which terminal opened (Terminal, iTerm, Ghostty)? Was it the one you use?

## 6. Watch a folder

1. Make an empty folder `inbox` on the Desktop.
2. `forge watch ~/Desktop/inbox --to webp`.
3. Drag two or three pictures into `inbox`. **Right:** each appears as a line
   with a tick, a new `.webp` is in the folder, and nothing is converted twice.
4. Press Ctrl+C. **Right:** it prints totals.

## 7. Transcribe (speech to text)

**Intel:** an Intel Mac cannot use Apple's speech engine, so Forge uses the
whisper extension and ffmpeg, like Windows and Linux.

1. Install ffmpeg: `brew install ffmpeg`.
2. Type `/extensions`. **Right:** **Speech to text (whisper.cpp)** is in the
   list. (If it is not listed, Apple's own engine worked on your Mac. Tell us
   your macOS version; that would be news.)
3. `forge extensions add whisper` (about 60 MB).
4. `forge transcribe talk.mp4` (your video or sound file). **Right:** a bar
   moves while it listens, then `talk.md` appears next to the file. Note how
   long a one-minute file takes.
5. Make the other formats and open each result:
   - `forge transcribe talk.mp4 --format docx --force`
   - `forge transcribe talk.mp4 --format pdf --force`
   - `forge transcribe talk.mp4 --format txt --force`
   **Right (PDF):** readable A4 pages with a title, and text you can select and
   copy. If the talk is not in English, the words should still show; only
   letters outside Latin, Greek and Cyrillic (Chinese, Arabic, Hindi...) show as `?`.
   To see who made the PDF: open it in Preview, Tools › Show Inspector. A
   producer of "Forge" is Forge's own writer; something else is Apple's.
   Tell us which you got.
6. In the app: press `5` (transcribe), drop the file, and follow the questions,
   choosing PDF as the format. **Right:** the same PDF and a done screen.
7. **Right:** no notes or summary. Asking for them with `--to notes` says
   plainly that this Mac does not have Apple Intelligence.
8. YouTube: `forge extensions add yt-dlp` (about 37 MB), then
   `forge transcribe "https://www.youtube.com/watch?v=jNQXAC9IVRw"` (19 seconds).
   **Right:** a file named after the video.

## 8. Reading text from a picture or PDF

1. Try `forge transcribe screenshot.png` (a screenshot with text) first. If
   your macOS is older than 26 it should ask for the **Read text** extension.
   If it reads the picture straight away, Apple's reader is working on your
   Mac; tell us.
2. If asked: `forge extensions add read-text` (about 23 MB), then run it again.
   **Right:** a `.md` file with the text. Compare it with the picture. Small
   mistakes are normal; whole lines missing or in a jumble are not.
3. Do the same with a scanned PDF, and with a normal PDF that has a table.
   **Right:** the table's cells are all there.
4. `forge transcribe page.png --format pdf --force`. **Right:** a PDF of the
   text, with a drawn table if there was one.

## 9. Colour and Figma

1. Press `6` (colour). **Right:** three cards: Extract, Scale, Palette.
2. **Extract:** drop a photo. **Right:** its main colours with percentages.
   Press `c` to copy the whole set.
3. **Scale:** type `6579FD`. **Right:** steps 50 to 950 with ratings. Press `c`.
4. Paste into Figma (⌘V). **Right:** real shapes and text layers named like
   `blue-500`. Without Figma, paste into TextEdit (plain text mode): **Right:**
   text that starts with `<svg`.
5. From the command line: `forge scale 6579FD` and `forge palette photo.jpg`.

## 10. /extensions and /update

1. Type `/extensions`. **Right:** a list of extensions, which are installed,
   their size and licence, and a bar showing the space Forge uses. Remove one
   (follow the keys at the bottom), then install it again.
2. Type `/update`. **Right:** it says you are up to date, or that a newer
   version exists. Do not install unless we ask.
3. `forge extensions` in the command line shows the same list.

## 11. Last: remove it

1. `forge uninstall`. **Right:** it says it removed the Quick Actions and then
   removed Forge.
2. Right-click a JPG › Quick Actions. **Right:** no Forge items left.

## What to send back

- Your Mac: the model and year, the processor (Apple menu › About This Mac),
  and the macOS version (or `sw_vers` in Terminal).
- `uname -m` and which terminal you used (Terminal, iTerm, Ghostty...).
- The output of `forge --version` and `forge extensions`.
- For each step that went wrong: its number, a screenshot, and the exact text
  of any error (copy and paste it, please).
- If something hung: how long you waited. Then run the same thing again with
  `--debug` on the end and send what it prints.
