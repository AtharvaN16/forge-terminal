# Testing Convert on Linux

Thanks for helping. This takes about an hour, and you can stop after any
part and send what you have. Do the steps in order. Write down anything that
looks odd, even if it still worked.

Each step says what to do, then **Right:** what you should see. If you see
something else, that is what we want to hear about. See "What to send back"
at the end.

You need a normal desktop session (GNOME, KDE, Xfce, Cinnamon...), not just
SSH. The clipboard and the right-click menu only exist there.

> **For whoever sends the build.** From the branch: `npm run build`, then
> `npm pack`. That makes `forge-terminal-<version>.tgz`; send that file. The
> tester installs it with the command in "Before you start".

## Files to have ready

You do not need all of these. Use what you have.

- a JPG and a PNG (a screenshot is fine)
- a HEIC photo from an iPhone, a camera RAW photo (`.CR2`, `.NEF`, `.ARW`, `.DNG`...)
- a PDF and a Word file (`.docx`)
- a video or sound file with someone talking, one or two minutes long
  (you can make the other kinds from it once ffmpeg is installed: `ffmpeg -i talk.mp4 -c copy talk.mkv` and `ffmpeg -i talk.mp4 -vn talk.flac`)
- a scanned page or a photo of a printed page (for reading text)

## Before you start

1. Install Node.js 20 or newer: your distro's package, or nodejs.org's build.
   `node --version` should say 20 or higher.
2. Install Convert:
   - from the internet: `npm i -g forge-terminal`
   - from a file you were sent: `npm i -g ./forge-terminal-<version>.tgz`
   - If npm says "permission denied", do not fix it with `sudo` if you can
     avoid it: run `npm config set prefix ~/.local`, make sure `~/.local/bin`
     is on your `PATH`, and try again. Tell us that it happened.
3. `forge --version`. **Right:** it prints the version you were told to expect.
4. Note what you have, we will ask for it at the end:
   - `echo $XDG_SESSION_TYPE` says `wayland` or `x11`
   - which desktop (GNOME, KDE, Xfce, Cinnamon...) and file manager
   - which terminal (GNOME Terminal, Konsole, Kitty, Alacritty...)
   - `uname -m` (`x86_64` or `aarch64`)

## 1. First start

1. `forge`, then Enter. **Right:** a home screen with tabs along the top
   (convert, compress, pdf, edit, transcribe, colour) and a box that says to drop
   a file. The first time it asks light or dark; pick one.
2. **Right:** once, it says it added itself to your file manager's right-click menu.
3. Type `/`. **Right:** a list of commands opens. Press Esc to close it.
4. Press Ctrl+C to quit.

## 2. Convert, compress, edit

Type `forge`, then drop a file onto the window (or type its path), then Enter.

1. Convert a JPG to PNG. **Right:** you pick a format, then a folder, then see
   a "done" screen with the before and after sizes.
2. On the done screen press `o`. **Right:** the file opens in your default app.
3. Press `f`. **Right:** your file manager opens on the folder. (It may not
   select the file; tell us what it did.)
4. Convert the PNG to WebP.
5. Press `2` (compress) on the home screen and compress a JPG with the slider.
   **Right:** the new file is smaller and still looks fine.
6. From the command line: `forge photo.jpg --max-size 300kb`. **Right:** a
   smaller `photo-small.jpg` next to the original.
7. Press `4` (edit) with a photo. Try **Resize**, **Rotate** and **Crop to shape**.
   **Right:** each makes a new file; a rotated photo is the right way up.
8. Press `3` (pdf) with a PDF: merge two, or split one. Also convert a PDF to
   images, and an image to a PDF.
9. Convert a Word file to PDF. It is fine if you do not have LibreOffice;
   note whether you do.
10. Edit mode, a small photo (about 1000 pixels wide): **Boost resolution** at 2x.
    The first time it offers the Boost extension (about 17 MB); install it.
    **Right:** the photo comes out twice as big. It runs on your graphics card
    (through Vulkan), so a small photo takes well under a minute; the very
    first time there is a pause of a few seconds before the bar moves.
    Note how long it took. Then try **Sharpen**, and a big photo (about 12
    megapixels): note the time.
    **Also right:** a PC with no working graphics driver stops a big photo early with
    "Too slow to boost", saying about how many minutes it would have taken,
    instead of making you wait. Tell us if you see that, and send the output
    of `vulkaninfo --summary` (from `vulkan-tools`), which lists your graphics card.
    **Remove background** should not be offered; it is Mac-only.

## 3. HEIC and RAW (extensions)

1. Convert a HEIC photo to JPG. **Right:** the first time it stops and says to
   open `/extensions`. Do that: type `/extensions`, install **HEIC photos**,
   then convert it again. **Right:** it works, and a portrait photo is upright.
2. If you have a RAW photo: the same, with the extension **Camera RAW photos** (or type `forge extensions add raw`).
   **Right:** a normal-looking, upright photo.

## 4. Pasting a picture

This needs `wl-clipboard` (Wayland) or `xclip` (X11).

1. Optional, only if you have neither installed: in Forge's home screen press
   Ctrl+V with a picture copied. **Right:** it names the tool to install.
2. Install the right one: `sudo apt install wl-clipboard` (Wayland) or
   `sudo apt install xclip` (X11), or your distro's equivalent.
3. Copy a picture: take a screenshot to the clipboard, or right-click a
   picture in your browser and choose "Copy image". Do not copy a file.
4. In Forge's home screen press **Ctrl+V**. **Right:** a card named "Copied image".
5. Choose compress. **Right:** no "Save as" question; the result goes back on
   the clipboard (as a picture).
6. Paste it somewhere (an image editor, a chat window). **Right:** the smaller
   picture appears.
7. Back in Forge, `u` on the done screen puts the original back.
8. From the command line: copy a picture, then `forge clip`.

## 5. The right-click menu and presets

Do this for each file manager you have (Nautilus, Nemo, Dolphin, Thunar).
Tell us which one you used each time.

1. Right-click a JPG.
   - **Nautilus (GNOME Files):** **Scripts › Forge**. If it is missing, close
     Files completely (`nautilus -q`) and open it again.
   - **Nemo, Dolphin, Thunar:** a **Forge** submenu.
   **Right:** Open Forge, Convert in Forge, Compress in Forge.
2. Choose **Convert in Forge**. **Right:** a terminal opens with that file ready.
3. In Nautilus, run a Forge item on a file Forge cannot take (for example a
   text file). **Right:** it says so, instead of doing nothing.
4. Right-click a PDF. **Right:** an **Open in Forge** item.
5. Make a preset: convert a photo to WebP, and on the done screen press `p`.
   Give it a name.
6. Type `/right-click`. **Right:** a line saying Forge is in the right-click
   menu, and a line "0 of 1 presets in the right-click menu". Press Enter on it
   and turn your preset on.
7. Right-click another JPG. **Right:** your preset is in the Forge menu. Choose
   it. **Right:** no window; a new WebP appears next to the photo. A desktop
   notification may appear (it needs `notify-send`; without it, nothing shows,
   and that is fine). Tell us which happened.
8. Which terminal opened when you used a menu item? Was it the one you use?

## 6. Watch a folder

1. Make an empty folder `inbox` in your home folder.
2. `forge watch ~/inbox --to webp`.
3. Copy two or three pictures into `inbox`. **Right:** each appears as a line
   with a tick, a new `.webp` is in the folder, and nothing is converted twice.
4. Press Ctrl+C. **Right:** it prints totals.

## 7. Transcribe (speech to text)

On Linux this uses the whisper extension and ffmpeg.

1. Install ffmpeg: `sudo apt install ffmpeg` (or your distro's).
2. On an Intel or AMD PC, check it has AVX2: `grep -c avx2 /proc/cpuinfo`
   prints a number above 0. If it prints 0, tell us; whisper will say it
   cannot run, and that is the right message.
3. `forge extensions add whisper` (about 60 MB).
4. `forge transcribe talk.mp4` (your video or sound file). **Right:** a bar
   moves while it listens, then `talk.md` appears next to the file.
   Then the same with two other kinds of file: `forge transcribe talk.mkv --force` (a video) and
   `forge transcribe talk.flac --force` (a sound file). **Right:** the same words as before. Both
   formats need ffmpeg. If either is refused, tell us the exact message.
5. Make the other formats and open each result:
   - `forge transcribe talk.mp4 --format docx --force` (LibreOffice or any Word reader)
   - `forge transcribe talk.mp4 --format pdf --force` (any PDF viewer)
   - `forge transcribe talk.mp4 --format txt --force`
   **Right (PDF):** readable A4 pages with a title, and text you can select and
   copy. If the talk is not in English, the words should still show; only
   letters outside Latin, Greek and Cyrillic (Chinese, Arabic, Hindi...) show as `?`.
6. In the app: press `5` (transcribe), drop the file, and follow the questions,
   choosing PDF as the format. **Right:** the same PDF and a done screen.
7. **Right:** there are no notes or summary (those need Apple's AI). Asking
   for them with `--to notes` says so plainly.
8. YouTube: `forge extensions add yt-dlp` (about 40 MB), then
   `forge transcribe "https://www.youtube.com/watch?v=jNQXAC9IVRw"` (19 seconds).
   **Right:** a file named after the video.

## 8. Reading text from a picture or PDF

1. `forge extensions add read-text` (about 20 to 24 MB).
2. `forge transcribe screenshot.png` (a screenshot with text, or a photo of a
   page). **Right:** a `.md` file with the text. Compare it with the picture.
   Small mistakes are normal; whole lines missing or in a jumble are not.
3. Do the same with a scanned PDF, and with a normal PDF that has a table.
   **Right:** the table's cells are all there.
4. `forge transcribe page.png --format pdf --force`. **Right:** a PDF of the
   text, with a drawn table if there was one.

## 9. Colour and Figma

1. Press `6` (colour). **Right:** three cards: Extract, Scale, Palette.
2. **Extract:** drop a photo. **Right:** its main colours with percentages.
   Press `c` to copy the whole set.
3. **Scale:** type `6579FD`. **Right:** steps 50 to 950 with ratings. Press `c`.
4. Paste into Figma (in your browser) with Ctrl+V. **Right:** real shapes and
   text layers named like `blue-500`. Without Figma, paste into a text editor:
   **Right:** text that starts with `<svg`. Tell us whether the paste worked, and
   whether you were on Wayland or X11.
5. From the command line: `forge scale 6579FD` and `forge palette photo.jpg`.

## 10. /extensions and /update

1. Type `/extensions`. **Right:** a list of extensions, which are installed,
   their size and licence, and a bar showing the space Forge uses. Remove the
   HEIC one (follow the keys at the bottom), then install it again.
2. Type `/update`. **Right:** it says you are up to date, or that a newer
   version exists. Do not install unless we ask.
3. `forge extensions` in the command line shows the same list.

## 11. Last: remove it

1. `forge uninstall`. **Right:** it says it removed the right-click menu and
   then removed Forge.
2. Close and reopen your file manager and right-click a JPG. **Right:** no Forge items left.

## What to send back

- Your distro and version (`cat /etc/os-release`), and `uname -m`.
- Your desktop, session type (Wayland or X11), file manager(s) and terminal.
- Whether `wl-clipboard` or `xclip` was installed.
- The output of `forge --version` and `forge extensions`.
- For each step that went wrong: its number, a screenshot, and the exact text
  of any error (copy and paste it, please).
- If something hung: how long you waited. Then run the same thing again with
  `--debug` on the end and send what it prints.
