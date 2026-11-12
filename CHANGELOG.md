# Changelog

## 1.1.5 — 2026-11-12

- Clarified that **Import Gallery** reads only the selected card site's Chub or BotBooru gallery.
- Kept creator notes, descriptions, greetings, and lorebooks exclusive to **Import Embedded Images**.
- Synchronized the extension's displayed version with the release version.

## 1.1.4 — 2026-11-12

- Kept **Import Gallery** focused on Chub or BotBooru's hosted gallery.
- Creator notes, descriptions, greetings, and lorebooks are scanned only when you click **Import Embedded Images**.
- Added a clear message when a card has no site gallery images and its notes may contain links instead.
- Published readable changelog and versioned extension ZIP.

## 1.1.3 — 2026-11-12

- Added Chub and BotBooru gallery imports to one **Import Gallery** button. The extension detects the card's source link, or asks for a link if the card has none.
- The **Import Embedded Images** button scans creator notes and card text for linked images and public galleries.
- Added image duplicate checks across the SillyTavern gallery and the current import. Images with identical contents are skipped even when they have different filenames or file metadata.
- New images use filenames derived from their contents, which prevents gallery ordering changes from replacing a different image.
- Added readable progress and results for imported images, duplicates, and download failures.
- Added support for public image pages and albums, including the Postimages, ImgBB, ImageBam, ImageVenue, Pixhost, Imgbox, ImageTwist, and ImgChest formats.
- BotBooru can request a session token for cards that require a login. The token is held in memory for the current SillyTavern page session.

## 1.0.11

- Initial documented release with Chub gallery import, embedded image import, and the Visual Novel avatar carousel.
