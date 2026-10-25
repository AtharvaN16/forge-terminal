# Testing Convert on Windows

Thanks for helping. This takes about an hour, and you can stop after any
part and send what you have. Do the steps in order. Write down anything that
looks odd, even if it still worked.

Each step says what to do, then **Right:** what you should see. If you see
something else, that is what we want to hear about. See "What to send back"
at the end.

> **For whoever sends the build.** From the branch: `npm run build`, then
> `npm pack`. That makes `forge-terminal-<version>.tgz`; send that file. The
> tester installs it with the command in "Before you start".

## Files to have ready

You do not need all of these. Use what you have.

- a JPG and a PNG (a screenshot is fine)
- a HEIC photo from an iPhone, taken upright (portrait) if you can
- a camera RAW photo (`.CR2`, `.NEF`, `.ARW`, `.DNG`...), if anyone you know has a camera
- a PDF, and a Word file (`.docx`)
- a video or sound file with someone talking, one or two minutes long
  (you can make the other kinds from it once ffmpeg is installed: `ffmpeg -i talk.mp4 -c copy talk.mkv` and `ffmpeg -i talk.mp4 -vn talk.flac`)
- a scanned page or a photo of a printed page (for reading text)

## Before you start

1. Install Node.js (the "LTS" version) from https://nodejs.org.
2. Open **Windows Terminal** (search for it in the Start menu). Use this, not
   the old black console, until the last part.
3. Install Convert:
   - from the internet: `npm i -g forge-terminal`
   - from a file you were sent: `npm i -g .\forge-terminal-<version>.tgz`
     (type the folder the file is in first, for example `cd Downloads`)
4. Type `forge --version`. **Right:** it prints the version you were told to expect.

## 1. First start

1. Type `forge` and press Enter. **Right:** a home screen with tabs along the
   top (convert, compress, pdf, edit, transcribe, colour) and a box that says to
   drop a file. The first time, it asks light or dark; pick one.
2. **Right:** once, it says it added itself to the right-click menu.
3. Type `/` in the box. **Right:** a list of commands opens. Press Esc to close it.
4. Press Ctrl+C to quit.

## 2. Convert, compress, edit

Type `forge`, then drop a file onto the window, or type its path, then Enter.

1. Convert a JPG to PNG. **Right:** you pick a format, then a folder, then see
   a "done" screen with the before and after sizes.
2. On the done screen press `o`. **Right:** the file opens in its usual app.
3. Press `f`. **Right:** File Explorer opens with the new file selected.
4. Convert the PNG to WebP.
5. Press `2` (compress) on the home screen and compress a JPG with the slider.
   **Right:** the new file is smaller and still looks fine.
6. From the command line: `forge photo.jpg --max-size 300kb`. **Right:** a
   smaller file, `photo-small.jpg`, next to the original.
7. Press `4` (edit) with a photo. Try **Resize**, **Rotate** and **Crop to shape**.
   **Right:** each makes a new file; a rotated photo is the right way up.
8. Press `3` (pdf) with a PDF: merge two, or split one. Also convert a PDF to
   images, and an image to a PDF.
9. Convert a Word file to PDF. It is fine if you do not have LibreOffice
   (libreoffice.org); note whether you do.

## 3. HEIC and RAW (extensions)

1. Convert a HEIC photo to JPG. **Right:** the first time it stops and says to
   open `/extensions`. Do that: type `/extensions`, install **HEIC photos**,
   then convert the photo again. **Right:** it works, and a portrait photo
   comes out taller than wide, upright.
2. If you have a RAW photo: convert it to JPG the same way. **Right:** the same
   "install it first" step (the extension is called **Camera RAW photos** (or type `forge extensions add raw`)),
   then a normal-looking photo, upright.
3. Press `4` (edit), pick a small photo, and try **Boost resolution** at 2x. It
   needs the **Boost** extension (about 23 MB). **Right:** you are offered the
   install, then it works. Note how long it took, and whether the screen
   showed that it was working.

## 4. Pasting a picture

1. Press Win+Shift+S and snip part of the screen, or right-click a picture in
   your browser and choose "Copy image". Do not copy a file.
2. In Forge's home screen press **Ctrl+V**. **Right:** a card named "Copied image".
3. Choose compress. **Right:** no "Save as" question; the result goes back on
   the clipboard.
4. Open Paint, Word or a chat window and press Ctrl+V. **Right:** the smaller picture appears.
5. Back in Forge, press `u` on the done screen. **Right:** the original goes back on the clipboard.
6. From the command line: copy a picture, then `forge clip`.

## 5. The right-click menu and presets

1. Right-click a JPG. On Windows 11 choose **Show more options** (or hold Shift
   while you right-click). **Right:** a **Forge** submenu with Open Forge,
   Convert in Forge, Compress in Forge (and Sharpen in Forge if you installed Boost).
2. Choose **Convert in Forge**. **Right:** a terminal opens with that file ready.
3. Right-click a PDF. **Right:** an **Open in Forge** item.
4. Make a preset: convert a photo to WebP, and on the done screen press `p`.
   Give it a name.
5. Type `/right-click`. **Right:** a line saying Forge is in the right-click
   menu, and a line "0 of 1 presets in the right-click menu". Press Enter on it
   and turn your preset on.
6. Right-click another JPG, then Show more options. **Right:** your preset is
   in the Forge submenu. Choose it. **Right:** no window; a new WebP file
   appears next to the photo. A notification may appear. Tell us if one does not.

## 6. Watch a folder

1. Make an empty folder, for example `inbox` on the Desktop.
2. In Windows Terminal: `forge watch Desktop\inbox --to webp`.
3. Copy two or three pictures into `inbox`. **Right:** each appears as a line
   with a tick, a new `.webp` is in the folder, and nothing is converted twice.
4. Press Ctrl+C. **Right:** it prints totals.

## 7. Transcribe (speech to text)

On Windows this uses the whisper extension and ffmpeg.

1. Install ffmpeg: `winget install ffmpeg`, then **close and reopen** Windows Terminal.
2. Install whisper: `forge extensions add whisper` (about 60 MB).
3. `forge transcribe talk.mp4` (your video or sound file). **Right:** a bar
   moves while it listens, then `talk.md` appears next to the file.
   Then the same with two other kinds of file: `forge transcribe talk.mkv --force` (a video) and
   `forge transcribe talk.flac --force` (a sound file). **Right:** the same words as before. Both
   formats need ffmpeg. If either is refused, tell us the exact message.
4. **If it says it needs the Microsoft Visual C++ Redistributable**, that is
   expected on some PCs. Install it from the link it shows, then run it again.
   Tell us whether you saw this.
5. Make the other formats. Run each, and open the result:
   - `forge transcribe talk.mp4 --format docx --force` opens in Word
   - `forge transcribe talk.mp4 --format pdf --force` opens in any PDF viewer
   - `forge transcribe talk.mp4 --format txt --force`
   **Right (PDF):** readable A4 pages with a title, the words you can select
   and copy. If the talk is not in English, the words should still show; only
   letters outside Latin, Greek and Cyrillic (Chinese, Arabic, Hindi...) show as `?`.
6. In the app: press `5` (transcribe), drop the file, and follow the questions,
   choosing PDF as the format. **Right:** the same PDF, and a done screen.
7. YouTube: `forge extensions add yt-dlp` (about 18 MB), then
   `forge transcribe "https://www.youtube.com/watch?v=jNQXAC9IVRw"` (a 19-second video).
   **Right:** a file named after the video.

## 8. Reading text from a picture or PDF

1. `forge extensions add read-text` (about 20 MB).
2. `forge transcribe screenshot.png` (a screenshot with text, or a photo of a page).
   **Right:** a `.md` file with the text. Open it next to the picture and
   compare. Small mistakes are normal; whole lines missing or in a jumble are not.
3. Do the same with a PDF that is a scan (a picture of a page), and with a
   normal PDF with a table in it. **Right:** the table's cells are all there.
4. `forge transcribe page.png --format pdf --force`. **Right:** a PDF of the
   text, with a drawn table if there was one.

## 9. Colour and Figma

1. Press `6` (colour). **Right:** three cards: Extract, Scale, Palette.
2. **Extract:** drop a photo. **Right:** its main colours with percentages. Use
   ↑↓, then press `c` to copy the whole set.
3. **Scale:** type `6579FD`. **Right:** steps 50 to 950 with ratings. Press `c`.
4. Paste into Figma (the web app or desktop) with Ctrl+V. **Right:** real
   shapes and text layers named like `blue-500`. If you have no Figma, paste
   into Notepad: **Right:** text that starts with `<svg`.
5. From the command line: `forge scale 6579FD` and `forge palette photo.jpg`.

## 10. /extensions and /update

1. Type `/extensions`. **Right:** a list of extensions, which are installed,
   their size and licence, and a bar showing the space Forge uses. Remove the
   HEIC one (follow the keys at the bottom), then install it again.
2. Type `/update`. **Right:** it says you are up to date, or that a newer
   version exists. Do not install unless we ask.
3. `forge extensions` in the command line shows the same list.

## 11. Then once in the old console

1. Press Win+R, type `conhost.exe`, and press Enter. This opens the older
   Windows console.
2. In that window run `forge`. **Right:** it starts and works, with plainer
   symbols and no mouse. Convert a JPG to PNG.

## 12. Last: remove it

1. `forge uninstall`. **Right:** it says it removed the right-click menu and
   then removed Forge.
2. Right-click a JPG. **Right:** no Forge items left.

## What to send back

- Your Windows version (press Win+R, type `winver`, press Enter).
- Which terminal you used (Windows Terminal, the old console, or other).
- Your PC model or chip (for example "Dell XPS 13" or "Snapdragon X").
- The output of `forge --version` and `forge extensions`.
- For each step that went wrong: its number, a screenshot, and the exact text
  of any error (copy and paste it, please).
- If something hung: how long you waited. Then run the same thing again with
  `--debug` on the end and send what it prints.
