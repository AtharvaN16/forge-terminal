# Testing Convert on Windows

Thanks for helping. This takes about 20 minutes. Do the steps in order, and
write down anything that looks odd, even if it still worked.

## Before you start

1. Install Node.js (the "LTS" version) from https://nodejs.org.
2. Open **Windows Terminal** (search for it in the Start menu).
3. Install Convert by typing this and pressing Enter:
   `npm i -g forge-terminal`
4. Check it worked by typing `forge --version`. It should print `0.3.1` or later.

## Try these

Use any files you have lying around. For each one, note whether it worked.

1. Type `forge` and press Enter. The home screen should appear.
2. Drop a JPG onto the window (or type its path) and convert it to PNG.
3. Convert a PNG to WebP.
4. Compress a JPG.
5. Convert a PDF to images.
6. Convert a Word file to PDF. Note whether you have LibreOffice installed
   (a free office program from libreoffice.org). It is fine if you don't.
7. Convert a HEIC photo from an iPhone. The first time, Forge shows an error
   saying "Open /extensions to install it". Do that: type `/extensions`,
   install HEIC photos, then convert the photo again.
8. Convert a HEIC photo taken with the iPhone held upright (portrait), or one
   you rotated in the Photos app. Is the result upright, and are the card's
   dimensions right (taller than wide for a portrait photo)?
9. Use "Boost resolution" at 2x on a small photo. Note roughly how long it took.
10. After any conversion, press `c` to copy the result's path. Open Notepad and
    paste it (Ctrl+V). Did the path appear?
11. Choose the option to open a result. Did the file open?
12. Choose "Show in Explorer". Did Explorer open with the file selected?

## Then once in the old console

1. Press Win+R, type `conhost.exe`, and press Enter. This opens the older
   Windows console.
2. In that window, repeat steps 1 and 2 from "Try these" above.

## What to send back

- Your Windows version (press Win+R, type `winver`, press Enter).
- Which terminal you used (Windows Terminal, the old console, or other).
- Your PC model or chip (for example "Dell XPS 13" or "Snapdragon X").
- A screenshot of anything that looked wrong.
- The exact text of any error message (copy and paste it, please).
