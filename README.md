# Waifu Avatar Extension for SillyTavern

Waifu Avatar is a lightweight SillyTavern extension that keeps the default UI intact while enhancing Visual Novel mode:

- Replaces VN sprite rendering with the active character avatar.
- Lets you import Chub.ai galleries directly into the character's SillyTavern gallery folder.
- Adds left/right click carousel navigation over the VN image (avatar + gallery images, no animation).
- Remembers the last selected image per character across browser reloads.

---

## Features

### 1) VN Avatar Replacement
- In Visual Novel mode, the extension displays one main image instead of expression sprites.
- The image area is anchored between the top bar and the chat panel.
- The active character avatar is used as the default image.

### 2) Chub Gallery Import
- A character edit button appears when the current card has a Chub source:
  - `data.extensions.chub.full_path`, or
  - `data.extensions.source_url` with a `chub.ai/characters/...` URL.
- Click **Import Chub Gallery** to fetch and store gallery images directly into ST gallery storage.
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

### Chub Gallery Import
1. Open a character card that has a Chub source URL/path.
2. In the character description header, click **Import Chub Gallery**.
3. Imported images are saved to that character's ST gallery folder.
4. Open the standard ST gallery (`/show-gallery`) to verify images.

---

## Notes

- The extension is designed to preserve the base SillyTavern layout outside its VN image behavior.
- If images seem stale after updates, do a hard refresh (`Ctrl+F5`).

---

## Troubleshooting

- **Import button not visible:** Ensure the card has a Chub source path/URL.
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
