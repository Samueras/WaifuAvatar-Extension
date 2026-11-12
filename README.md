# Waifu Avatar Extension for SillyTavern

**Latest release: 1.1.5.** See [CHANGELOG.md](CHANGELOG.md) for the release notes.

Waifu Avatar is a lightweight SillyTavern extension that keeps the default UI intact while enhancing Visual Novel mode:

- Replaces VN sprite rendering with the active character avatar.
- Lets you import Chub.ai and BotBooru galleries directly into the character's SillyTavern gallery folder.
- Imports embedded images and linked public albums from creator notes, descriptions, greetings, and lorebooks.
- Adds left/right click carousel navigation over the VN image (avatar + gallery images, no animation).
- Remembers the last selected image per character across browser reloads.

---

## Features

### 1) VN Avatar Replacement
- In Visual Novel mode, the extension displays one main image instead of expression sprites.
- The image area is anchored between the top bar and the chat panel.
- The active character avatar is used as the default image.

### 2) Gallery Import
- A single **Import Gallery** button detects Chub or BotBooru from the card's source metadata, including `data.extensions.source_url`, V3 `data.source`, and Chub's `full_path`. It imports only the gallery hosted on that site.
- If no supported source is stored, a popup asks for a Chub or BotBooru character URL. Successful URLs are remembered per character in this browser.
- Use **Import Embedded Images** separately to scan creator notes, descriptions, greetings, and lorebooks for linked images and public albums.
- Images are uploaded via SillyTavern's own upload helper path for compatibility.

### 3) VN Carousel (Left/Right Click)
- Click the **left half** of the displayed image to go backward.
- Click the **right half** to go forward.
- Carousel list = `[Avatar] + [Character Gallery Images]`.
- Switching character uses that character's own independent carousel state.

### 4) Persistent Per-Character State
- Last selected carousel image is saved per character avatar key.
- On reload, the extension restores that character's last viewed image when available.

---

## Installation

### Option A: Extension Manager (recommended)
1. Open **Extensions** in SillyTavern.
2. Install from Git URL:
   - `https://github.com/Samueras/WaifuAvatar-Extension`
3. Enable **Waifu Avatar**.
4. Reload SillyTavern.

### Option B: Manual folder install
1. Copy this folder into:
   - `data/default-user/extensions/WaifuAvatar-Extension`
2. Reload SillyTavern and enable the extension.

---

## Usage

### VN Mode
1. Enable Visual Novel mode in SillyTavern.
2. The avatar view appears automatically.
3. Click left/right side of the image to cycle through avatar/gallery entries.

### Gallery Import (Chub and BotBooru)
1. Select the destination character and click **Import Gallery** in its description header.
2. The provider is selected automatically from the card's source link. If it has no Chub or BotBooru source, a popup asks for a URL such as `https://chub.ai/characters/creator/card` or `https://botbooru.com/character/12345`. Invalid URLs stay in the popup for correction; Cancel imports nothing.
3. The gallery importer downloads the provider's hosted gallery. Click **Import Embedded Images** when you also want images linked from creator notes, descriptions, greetings, and lorebooks. Matching images are skipped by either importer.
4. Imported images are saved to the selected character's SillyTavern gallery folder. Open `/show-gallery` to view them.

If BotBooru requires authentication, the connection dialog explains how to copy your session token from your logged-in BotBooru tab (Developer Tools → Application → Local Storage → `https://botbooru.com` → `token`). Paste it into the password field. The extension keeps it in memory until the SillyTavern page is reloaded; it is only sent to BotBooru through the SillyTavern proxy, never to image hosts.

Cards exported from BotBooru may retain a Chub source URL. The importer follows the source recorded in the card; links to other bots in creator notes are not used to identify the current card.

### Creator Notes and File Hosts
Click **Import Embedded Images** to scan creator notes (including SillyTavern's `creatorcomment` field), description, first message, alternate greetings, embedded character lorebook, and attached world lorebook. Markdown, HTML, and plain image/album URLs are read.

The resolver supports direct image files (including Catbox links), Postimages image pages and albums, and public HTML image pages. It can follow image-view links on Postimages, ImgBB, ImageBam, ImageVenue, Pixhost, Imgbox, ImageTwist, and ImgChest, and same-site “next” links. Other hosts can work when they publish their image URLs in HTML; host compatibility varies. Original image links are preferred over thumbnails. Remote scripts are never executed.

Password-protected albums, CAPTCHAs, encrypted folders such as MEGA, ZIP archives, and hosts requiring JavaScript or private APIs need separate support. These are not universal file-host downloads. Unreadable pages and failed downloads produce warnings; details appear in the browser console. Each scan is bounded to 80 pages and 500 images.

Cross-site reads fall back to SillyTavern's own CORS proxy. If a host blocks direct browser access, set `enableCorsProxy: true` in your SillyTavern server's `config.yaml`, then restart the server. A Chrome login by itself does not authenticate API requests made from SillyTavern. Reload SillyTavern with **Ctrl+F5** after updating the extension.

Successful imports refresh the current VN carousel automatically.

### Duplicate Images

Both import buttons compare incoming images against the destination character's existing gallery and images saved earlier in the same import. Images are decoded and converted to PNG, then compared with SHA-256 fingerprints. Identical rendered images are skipped even when their filenames, URLs, source sites, or file metadata differ. The result reports new images, skipped duplicates, and download failures separately.

Existing gallery images are checked again on every import so renamed, added, or deleted files are reflected. If the gallery cannot be listed, the import stops; individual unreadable images produce a warning. New images use filenames based on their content to avoid overwriting other images when a remote gallery changes its ordering. Existing files are not renamed or removed.

An image at a different URL must still be fetched to compare its content, but a matching image is not uploaded or stored again. Resized images and pictures changed by lossy recompression may have different pixels and are treated as separate images. Animated images follow the extension's existing still-PNG conversion behavior.

---

## Notes

- The extension is designed to preserve the base SillyTavern layout outside its VN image behavior.
- If images seem stale after updates, do a hard refresh (`Ctrl+F5`).

---

## Troubleshooting

- **Import button not visible:** Select a character and open its description editor. The gallery button is available even without a source URL.
- **No VN image changes:** Confirm Visual Novel mode is enabled.
- **Gallery not cycling:** Make sure the character has imported images in gallery, then reload chat/character once.
- **General issues:** Reload SillyTavern and check browser console for `[WaifuAvatar]` logs.

---

## License

This project is licensed under GNU GPL v3.0. See the [LICENSE](LICENSE) file.

---

## ❤️ Support the Project

If this extension helps you, please consider supporting my work:

- [☕ Buy me a coffee on Ko-fi](https://ko-fi.com/samueras)
