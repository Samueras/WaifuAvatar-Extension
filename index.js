(function () {
    const EXT_VERSION = '1.1.5';
    const FALLBACK_WRAPPER_ID = 'wacg-vn-fallback-wrapper';
    const HOLDER_ID = 'wacg-vn-holder';
    const IMAGE_ID = 'wacg-vn-image';
    const LEFT_ZONE_ID = 'wacg-vn-zone-left';
    const RIGHT_ZONE_ID = 'wacg-vn-zone-right';
    const BUTTON_ID = 'wacg-download-gallery-btn';
    const EMBEDDED_BUTTON_ID = 'wacg-import-embedded-btn';
    const getGalleryTools = () => import('./gallery-import.js');
    let botbooruToken = '';
    const POLL_INTERVAL_MS = 1000;
    const CAROUSEL_STATE_KEY = 'waifu_avatar_carousel_state_v1';

    if (window.__wacgExtensionLoaded) {
        return;
    }
    window.__wacgExtensionLoaded = true;

    let avatarIntervalId = null;
    let isDownloading = false;
    let stSaveBase64AsFile = null;
    let stSha256 = null;
    const carouselState = {
        avatarFile: '',
        sources: [],
        index: 0,
        loading: false,
        loaded: false,
        preferredSrc: '',
    };

    function loadCarouselStateMap() {
        try {
            const raw = localStorage.getItem(CAROUSEL_STATE_KEY);
            if (!raw) {
                return {};
            }

            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    function saveCarouselStateMap(map) {
        try {
            localStorage.setItem(CAROUSEL_STATE_KEY, JSON.stringify(map));
        } catch {
            // Ignore storage write issues.
        }
    }

    function getStoredCarouselSrc(avatarFile) {
        const stateMap = loadCarouselStateMap();
        const value = stateMap?.[avatarFile];
        return typeof value === 'string' ? value : '';
    }

    function setStoredCarouselSrc(avatarFile, src) {
        if (!avatarFile || !src) {
            return;
        }

        const stateMap = loadCarouselStateMap();
        stateMap[avatarFile] = src;
        saveCarouselStateMap(stateMap);
    }

    function getContextSafe() {
        if (!window.SillyTavern || typeof window.SillyTavern.getContext !== 'function') {
            return null;
        }
        return window.SillyTavern.getContext();
    }

    function debounce(fn, delay) {
        let timeout = null;
        return function (...args) {
            if (timeout) {
                window.clearTimeout(timeout);
            }
            timeout = window.setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function getCurrentCharacterAvatarFile() {
        const context = getContextSafe();
        if (!context) {
            return null;
        }

        if (context.groupId) {
            const reversedChat = (context.chat || []).slice().reverse();

            for (const mes of reversedChat) {
                if (mes?.is_user || mes?.is_system) {
                    continue;
                }

                const avatarFromMessage =
                    mes?.original_avatar ||
                    context.characters?.find(
                        (char) =>
                            mes?.force_avatar &&
                            char?.avatar &&
                            mes.force_avatar.includes(encodeURIComponent(char.avatar)),
                    )?.avatar;

                if (avatarFromMessage) {
                    return avatarFromMessage;
                }
            }

            return (
                context.groups?.find((group) => String(group.id) === String(context.groupId))?.members?.[0] ??
                null
            );
        }

        const characterId = Number(context.characterId);
        if (!Number.isFinite(characterId) || characterId < 0) {
            return null;
        }

        return context.characters?.[characterId]?.avatar ?? null;
    }

    function ensureVnHolder() {
        let wrapper = $('#visual-novel-wrapper');

        if (!wrapper.length) {
            wrapper = $(`#${FALLBACK_WRAPPER_ID}`);
            if (!wrapper.length) {
                wrapper = $(`<div id="${FALLBACK_WRAPPER_ID}"></div>`);
                $('body').append(wrapper);
            }
        }

        let holder = wrapper.find(`#${HOLDER_ID}`);
        if (!holder.length) {
            holder = $(`<div id="${HOLDER_ID}" class="expression-holder"></div>`);
            holder.append($(`<img id="${IMAGE_ID}" class="expression" alt="Character avatar">`));
            holder.append($(`<div id="${LEFT_ZONE_ID}" class="wacg-vn-click-zone wacg-vn-click-zone-left" title="Previous image"></div>`));
            holder.append($(`<div id="${RIGHT_ZONE_ID}" class="wacg-vn-click-zone wacg-vn-click-zone-right" title="Next image"></div>`));
            wrapper.append(holder);

            holder.find(`#${LEFT_ZONE_ID}`).on('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await stepCarousel(-1);
            });
            holder.find(`#${RIGHT_ZONE_ID}`).on('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await stepCarousel(1);
            });
        }

        return holder;
    }

    function getGalleryFolderForAvatar(avatarFile) {
        const context = getContextSafe();
        if (!context || !avatarFile) {
            return null;
        }

        const character = context.characters?.find((char) => char?.avatar === avatarFile);
        if (!character) {
            return null;
        }

        const gallerySettings = context.extensionSettings?.gallery;
        return gallerySettings?.folders?.[avatarFile] ?? character.name;
    }

    async function ensureCarouselSources(avatarFile) {
        if (!avatarFile || carouselState.loading || carouselState.loaded) {
            return;
        }

        const context = getContextSafe();
        if (!context || typeof context.getRequestHeaders !== 'function') {
            return;
        }

        carouselState.loading = true;
        try {
            const folderName = getGalleryFolderForAvatar(avatarFile);
            if (!folderName) {
                carouselState.loaded = true;
                return;
            }

            const response = await fetch('/api/images/list', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({
                    folder: folderName,
                    sortField: 'date',
                    sortOrder: 'asc',
                }),
            });

            if (!response.ok) {
                carouselState.loaded = true;
                return;
            }

            const files = await response.json();
            if (!Array.isArray(files) || files.length === 0) {
                carouselState.loaded = true;
                return;
            }

            const encodedFolder = encodeURIComponent(folderName);
            const gallerySources = files
                .map((file) => `user/images/${encodedFolder}/${encodeURIComponent(String(file))}`)
                .filter((src) => typeof src === 'string' && src.length > 0);

            const merged = [
                ...carouselState.sources,
                ...gallerySources,
            ];
            carouselState.sources = [...new Set(merged)];
            carouselState.loaded = true;
        } catch (error) {
            console.warn('[WaifuAvatar] Failed to load carousel gallery sources:', error);
            carouselState.loaded = true;
        } finally {
            carouselState.loading = false;
        }
    }

    function applyCarouselImage() {
        const holder = ensureVnHolder();
        if (!holder.length || !carouselState.sources.length) {
            return;
        }

        if (carouselState.preferredSrc) {
            const preferredIndex = carouselState.sources.indexOf(carouselState.preferredSrc);
            if (preferredIndex >= 0) {
                carouselState.index = preferredIndex;
            }
        }

        const image = holder.find(`#${IMAGE_ID}`);
        const src = carouselState.sources[carouselState.index] || carouselState.sources[0];
        if (src && image.attr('src') !== src) {
            image.attr('src', src);
        }
        if (src && carouselState.avatarFile) {
            setStoredCarouselSrc(carouselState.avatarFile, src);
        }
    }

    async function stepCarousel(direction) {
        const isWaifuMode = $('body').hasClass('waifuMode');
        if (!isWaifuMode) {
            return;
        }

        const avatarFile = getCurrentCharacterAvatarFile();
        if (!avatarFile) {
            return;
        }

        const avatarUrl = `characters/${avatarFile}`;
        if (carouselState.avatarFile !== avatarFile) {
            carouselState.avatarFile = avatarFile;
            carouselState.sources = [avatarUrl];
            carouselState.index = 0;
            carouselState.loading = false;
            carouselState.loaded = false;
            carouselState.preferredSrc = getStoredCarouselSrc(avatarFile);
        }

        await ensureCarouselSources(avatarFile);

        if (!carouselState.sources.length) {
            return;
        }

        const total = carouselState.sources.length;
        carouselState.index = (carouselState.index + direction + total) % total;
        applyCarouselImage();
    }

    function syncVnBounds() {
        const fallbackWrapper = $(`#${FALLBACK_WRAPPER_ID}`);
        if (!fallbackWrapper.length) {
            return;
        }

        const topBarBottom = $('#top-bar')[0]?.getBoundingClientRect().bottom ?? 0;
        const sheldTop = $('#sheld')[0]?.getBoundingClientRect().top ?? window.innerHeight;
        const wrapperHeight = Math.max(0, sheldTop - topBarBottom);

        fallbackWrapper.css({
            top: `${topBarBottom}px`,
            height: `${wrapperHeight}px`,
        });
    }

    function syncWaifuAvatar() {
        const isWaifuMode = $('body').hasClass('waifuMode');
        const fallbackWrapper = $(`#${FALLBACK_WRAPPER_ID}`);
        const holder = ensureVnHolder();

        if (!holder?.length) {
            return;
        }

        if (!isWaifuMode) {
            fallbackWrapper.hide();
            holder.hide();
            return;
        }

        const avatarFile = getCurrentCharacterAvatarFile();
        if (!avatarFile || avatarFile === 'none') {
            fallbackWrapper.hide();
            holder.hide();
            return;
        }

        const avatarUrl = `characters/${avatarFile}`;
        if (carouselState.avatarFile !== avatarFile) {
            carouselState.avatarFile = avatarFile;
            carouselState.sources = [avatarUrl];
            carouselState.index = 0;
            carouselState.loading = false;
            carouselState.loaded = false;
            carouselState.preferredSrc = getStoredCarouselSrc(avatarFile);
            // Fire and forget: gallery list enriches carousel after avatar is shown.
            ensureCarouselSources(avatarFile);
        }

        holder.attr('data-avatar', avatarFile);
        holder.css('display', 'flex');
        if (fallbackWrapper.length) {
            syncVnBounds();
            fallbackWrapper.show();
        }
        applyCarouselImage();
        holder.show();
    }

    function getCurrentCharacterData() {
        const context = getContextSafe();
        if (!context) {
            return null;
        }

        const characterId = Number(context.characterId);
        if (!Number.isFinite(characterId) || characterId < 0) {
            return null;
        }

        return context.characters?.[characterId] ?? null;
    }

    function getGalleryFolderForCurrentCharacter() {
        const context = getContextSafe();
        const character = getCurrentCharacterData();
        if (!context || !character) {
            return null;
        }

        const avatarKey = character.avatar;
        const gallerySettings = context.extensionSettings?.gallery;
        return gallerySettings?.folders?.[avatarKey] ?? character.name;
    }

    function getChubHeaders() {
        const headers = { Accept: 'application/json' };

        const tokenRaw = localStorage.getItem('URQL_TOKEN');
        if (typeof tokenRaw === 'string' && tokenRaw.trim()) {
            const token = tokenRaw.replace(/^"+|"+$/g, '').trim();
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
        }

        return headers;
    }

    async function fetchChubCharacterNode(chubPath) {
        const encodedPath = chubPath.split('/').map(part => encodeURIComponent(decodeURIComponent(part))).join('/');
        const url = `https://api.chub.ai/api/characters/${encodedPath}?full=true`;
        const { fetchRemote } = await getGalleryTools();
        const response = await fetchRemote(url, getChubHeaders());
        if (!response.ok) {
            throw new Error(`Failed to fetch character info (${response.status})`);
        }

        const data = await response.json();
        if (!data?.node) {
            throw new Error('Character info missing node data');
        }

        return data.node;
    }

    async function fetchAllGalleryNodes(cardId) {
        const allNodes = [];
        const limit = 24;

        for (let page = 1; page <= 20; page++) {
            const url = `https://api.chub.ai/api/gallery/project/${encodeURIComponent(cardId)}?nsfw=true&page=${page}&limit=${limit}`;
            const { fetchRemote } = await getGalleryTools();
            const response = await fetchRemote(url, getChubHeaders());
            if (!response.ok) {
                throw new Error(`Failed to fetch gallery page ${page} (${response.status})`);
            }

            const data = await response.json();
            const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
            allNodes.push(...nodes);

            if (nodes.length < limit) {
                break;
            }
        }

        return allNodes;
    }

    async function blobToPngDataUrl(blob) {
        const objectUrl = URL.createObjectURL(blob);
        try {
            const image = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = objectUrl;
            });

            const canvas = document.createElement('canvas');
            canvas.width = image.width || 1;
            canvas.height = image.height || 1;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Canvas context unavailable');
            }
            ctx.drawImage(image, 0, 0);
            return canvas.toDataURL('image/png');
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function extractEmbeddedImageUrls(text) {
        const urls = [];
        const source = String(text || '');
        if (!source) {
            return urls;
        }

        // Markdown image syntax: ![alt](url "optional title")
        const markdownRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
        let markdownMatch;
        while ((markdownMatch = markdownRegex.exec(source)) !== null) {
            if (markdownMatch[1]) {
                urls.push(markdownMatch[1]);
            }
        }

        // HTML image syntax: <img src="...">
        const htmlRegex = /<img[^>]+src=["']([^"']+)["']/gi;
        let htmlMatch;
        while ((htmlMatch = htmlRegex.exec(source)) !== null) {
            if (htmlMatch[1]) {
                urls.push(htmlMatch[1]);
            }
        }

        return urls;
    }

    function normalizeImageUrl(url) {
        const raw = String(url || '').trim();
        if (!raw) {
            return '';
        }

        if (raw.startsWith('data:image/')) {
            return raw;
        }

        try {
            const parsed = new URL(raw, window.location.origin);
            return /^https?:$/.test(parsed.protocol) ? parsed.toString() : '';
        } catch {
            return '';
        }
    }

    async function getEmbeddedImageUrlsForCurrentCharacter(character = getCurrentCharacterData()) {
        if (!character) {
            return [];
        }

        const { characterTexts, extractLinks } = await getGalleryTools();
        const texts = characterTexts(character);
        const urls = texts.flatMap(text => [
            ...extractEmbeddedImageUrls(text).filter(url => url.startsWith('data:image/')), ...extractLinks(text),
        ]);
        const normalized = urls.map(normalizeImageUrl).filter(Boolean);
        return [...new Set(normalized)];
    }

    async function getCharacterLorebookImageUrls(character = getCurrentCharacterData()) {
        const { extractLinks } = await getGalleryTools();
        if (!character) {
            return [];
        }

        const worldName = character?.data?.extensions?.world;
        if (typeof worldName !== 'string' || !worldName.trim()) {
            return [];
        }

        const context = getContextSafe();
        if (!context || typeof context.getRequestHeaders !== 'function') {
            return [];
        }

        let data;
        try {
            const response = await fetch('/api/worldinfo/get', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({ name: worldName }),
                cache: 'no-cache',
            });
            if (!response.ok) {
                console.warn('[WaifuAvatar] Lorebook fetch failed:', worldName, response.status);
                return [];
            }
            data = await response.json();
        } catch (error) {
            console.warn('[WaifuAvatar] Lorebook fetch error:', error);
            return [];
        }

        const entries = data?.entries;
        if (!entries || typeof entries !== 'object') {
            return [];
        }

        const urls = [];
        for (const entry of Object.values(entries)) {
            const fields = [entry?.content, entry?.comment, entry?.key];
            for (const field of fields) {
                if (typeof field === 'string') {
                    urls.push(...extractEmbeddedImageUrls(field).filter(url => url.startsWith('data:image/')), ...extractLinks(field));
                } else if (Array.isArray(field)) {
                    for (const item of field) {
                        if (typeof item === 'string') {
                            urls.push(...extractEmbeddedImageUrls(item).filter(url => url.startsWith('data:image/')), ...extractLinks(item));
                        }
                    }
                }
            }
        }

        const normalized = urls.map(normalizeImageUrl).filter(Boolean);
        return [...new Set(normalized)];
    }

    async function normalizeGalleryImage(blob) {
        // Canvas strips file metadata and normalizes formats before comparing.
        const dataUrl = await blobToPngDataUrl(blob);
        const base64 = String(dataUrl.split(',')[1] || '').replace(/\s+/g, '');
        if (!base64) throw new Error('Failed to encode image as base64');
        if (!stSha256) {
            // ST bundles SHA-256, including for HTTP/LAN pages without crypto.subtle.
            const library = await import('/lib.js');
            stSha256 = library.sha256;
        }
        return { base64, fingerprint: stSha256(base64) };
    }

    async function getGalleryImageFingerprints(folderName, button) {
        const context = getContextSafe();
        if (typeof context?.getRequestHeaders !== 'function') throw new Error('Cannot check the existing gallery: SillyTavern context is unavailable.');
        const response = await fetch('/api/images/list', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ folder: folderName }),
            cache: 'no-store',
        });
        if (!response.ok) throw new Error('Cannot check the existing gallery (' + response.status + '). Import stopped to avoid duplicates.');
        const files = await response.json();
        if (!Array.isArray(files)) throw new Error('Cannot check the existing gallery: invalid file list.');
        const fingerprints = new Set();
        let unreadable = 0;
        if (files.length) toastr.info('Checking ' + files.length + ' existing gallery image(s) for duplicates...');
        for (let i = 0; i < files.length; i++) {
            if (button) button.title = 'Checking existing images ' + (i + 1) + '/' + files.length + '...';
            const url = '/user/images/' + encodeURIComponent(folderName) + '/' + encodeURIComponent(String(files[i]));
            try {
                const image = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
                if (!image.ok) throw new Error('HTTP ' + image.status);
                const normalized = await normalizeGalleryImage(await image.blob());
                fingerprints.add(normalized.fingerprint);
            } catch (error) {
                unreadable++;
                console.warn('[WaifuAvatar] Could not compare existing image:', files[i], error);
            }
        }
        if (unreadable) toastr.warning(unreadable + ' existing image(s) could not be checked for duplicates.');
        return fingerprints;
    }

    async function uploadImageToStGallery(imageUrl, folderName, options = {}) {
        let response;
        if (String(imageUrl).startsWith('data:image/')) {
            response = await fetch(imageUrl);
        } else {
            const { fetchRemote } = await getGalleryTools();
            response = await fetchRemote(imageUrl, options.headers || {});
        }
        if (!response.ok) throw new Error('Failed to fetch gallery image (' + response.status + ')');
        const { base64, fingerprint } = await normalizeGalleryImage(await response.blob());
        if (options.fingerprints?.has(fingerprint)) return false;
        if (!stSaveBase64AsFile) {
            const utilsModule = await import('/scripts/utils.js');
            stSaveBase64AsFile = utilsModule.saveBase64AsFile;
        }
        if (typeof stSaveBase64AsFile !== 'function') throw new Error('ST upload helper is unavailable');
        // Content-based filenames also avoid overwriting different images when the
        // ordering of a remote gallery changes between imports.
        await stSaveBase64AsFile(base64, folderName, 'waifu-' + fingerprint, 'png');
        // A failed save must remain eligible for another attempt later in the run.
        options.fingerprints?.add(fingerprint);
        return true;
    }

    async function importImageUrls(urls, folderName, button) {
        const fingerprints = await getGalleryImageFingerprints(folderName, button);
        let imported = 0;
        let duplicates = 0;
        let failed = 0;
        const uniqueUrls = [...new Set(urls)];
        for (let i = 0; i < uniqueUrls.length; i++) {
            if (button) button.title = 'Importing ' + (i + 1) + '/' + uniqueUrls.length + '...';
            try {
                const saved = await uploadImageToStGallery(uniqueUrls[i], folderName, { fingerprints });
                if (saved) imported++;
                else duplicates++;
            } catch (error) {
                failed++;
                console.warn('[WaifuAvatar] Gallery image skipped:', error);
            }
        }
        const message = 'Imported ' + imported + ' new image(s); skipped ' + duplicates + ' duplicate(s).';
        if (imported) toastr.success(message);
        else if (duplicates) toastr.info(message);
        else toastr.warning('No images could be imported.');
        if (failed) toastr.warning(failed + ' image(s) could not be downloaded. Check the console for host errors.');
        return { imported, duplicates, failed };
    }

    async function requestCardSource(character) {
        const { findCardSource, parseCardSource } = await getGalleryTools();
        const key = 'waifu_avatar_gallery_source_' + character.avatar;
        let saved = '';
        try { saved = localStorage.getItem(key) || localStorage.getItem('waifu_avatar_botbooru_' + character.avatar) || ''; } catch { /* storage unavailable */ }
        const detected = findCardSource(character, saved);
        if (detected) return detected;
        return new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.className = 'wacg-auth-dialog';
            dialog.innerHTML = '<form method="dialog"><h3>Import Gallery</h3>' +
                '<p>This card has no Chub or BotBooru source link. Paste its card URL to import its gallery and linked albums.</p>' +
                '<label>Card URL <input class="text_pole" type="url" placeholder="https://chub.ai/characters/creator/card or https://botbooru.com/character/12345" required></label>' +
                '<p class="wacg-source-error" role="alert"></p>' +
                '<button class="menu_button" value="import">Import</button>' +
                '<button class="menu_button" value="cancel" formnovalidate>Cancel</button></form>';
            dialog.querySelector('form').addEventListener('submit', event => {
                if (event.submitter?.value === 'cancel') return;
                if (!parseCardSource(dialog.querySelector('input').value)) {
                    event.preventDefault();
                    dialog.querySelector('.wacg-source-error').textContent = 'Enter a Chub or BotBooru character URL.';
                }
            });
            dialog.addEventListener('close', () => {
                const source = dialog.returnValue === 'import' ? parseCardSource(dialog.querySelector('input').value) : null;
                dialog.remove();
                resolve(source);
            }, { once: true });
            document.body.appendChild(dialog);
            dialog.showModal();
        });
    }

    async function downloadGalleryFromCurrentCharacter() {
        if (isDownloading) return;
        const character = getCurrentCharacterData();
        const folder = getGalleryFolderForCurrentCharacter();
        if (!character || !folder) { toastr.warning('Select a character to import into.'); return; }
        const avatarFile = character.avatar;
        const button = document.getElementById(BUTTON_ID);
        isDownloading = true;
        button?.classList.add('disabled');
        try {
            const source = await requestCardSource(character);
            if (!source) return;
            const provider = source.provider === 'chub' ? 'Chub' : 'BotBooru';
            toastr.info('Fetching ' + provider + ' gallery...');
            const remote = source.provider === 'chub'
                ? await collectChubGallery(source) : await collectBotbooruGallery(source);
            if (!remote) return;
            try { localStorage.setItem('waifu_avatar_gallery_source_' + avatarFile, source.url); } catch { /* storage unavailable */ }
            const urls = [...new Set(remote.images)];
            if (!urls.length) { toastr.info('No site gallery images found for this card. Use Import Embedded Images for links in creator notes or the description.'); return; }
            const { imported } = await importImageUrls(urls, folder, button);
            if (imported) refreshImportedGallery(avatarFile);
        } catch (error) {
            console.error('[WaifuAvatar] Gallery import failed:', error);
            toastr.error('Gallery import failed: ' + (error.message || error));
        } finally {
            isDownloading = false;
            button?.classList.remove('disabled');
            if (button) button.title = 'Import Chub or BotBooru gallery';
        }
    }

    async function collectChubGallery(source) {
        let node;
        try {
            node = await fetchChubCharacterNode(source.path);
        } catch (error) {
            console.warn('[WaifuAvatar] Chub character unavailable:', error);
            toastr.warning('Chub could not be reached; checking images and linked albums stored in this card.');
            return { images: [] };
        }
        const { normalizeUrl } = await getGalleryTools();
        let images = [];
        try {
            if (!node.id) throw new Error('Chub card id was not found');
            const nodes = await fetchAllGalleryNodes(node.id);
            images = nodes.map(item => normalizeUrl(item?.primary_image_path, 'https://chub.ai')).filter(Boolean);
        } catch (error) {
            console.warn('[WaifuAvatar] Chub gallery unavailable:', error);
            toastr.warning('Chub gallery could not be read. Use Import Embedded Images to scan creator notes and linked albums.');
        }
        return { images };
    }

    function refreshImportedGallery(avatarFile) {
        if (carouselState.avatarFile === avatarFile) {
            carouselState.loaded = false;
            ensureCarouselSources(avatarFile);
        }
    }

    async function requestBotbooruToken() {
        return new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.className = 'wacg-auth-dialog';
            dialog.innerHTML = `<form method="dialog">
                <h3>Connect BotBooru</h3>
                <p>BotBooru requires a login to read this card. Your Chrome login is separate from SillyTavern.</p>
                <p>On botbooru.com while logged in, open Developer Tools → Application → Local Storage → https://botbooru.com. Copy the value named <b>token</b> into this field.</p>
                <label>BotBooru session token <input class="text_pole" type="password" name="token" autocomplete="off" required></label>
                <p>The token stays in memory until this page is reloaded. It is sent only to BotBooru through your SillyTavern server.</p>
                <button class="menu_button" value="connect">Connect</button>
                <button class="menu_button" value="cancel" formnovalidate>Cancel</button>
            </form>`;
            dialog.addEventListener('close', () => {
                const value = dialog.returnValue === 'connect' ? dialog.querySelector('input').value.trim() : '';
                dialog.remove();
                resolve(value);
            }, { once: true });
            document.body.appendChild(dialog);
            dialog.showModal();
        });
    }

    async function collectBotbooruGallery(source) {
        const { fetchRemote, normalizeUrl } = await getGalleryTools();
        const endpoint = 'https://botbooru.com/post/' + source.id;
        const readPost = async () => {
            const headers = botbooruToken ? { Authorization: 'Bearer ' + botbooruToken } : {};
            const response = await fetchRemote(endpoint, headers);
            return { response, post: await response.json() };
        };
        let result = await readPost();
        if (result.post?.detail === 'login_required' || [401, 403].includes(result.response.status)) {
            botbooruToken = await requestBotbooruToken();
            if (!botbooruToken) return null;
            result = await readPost();
        }
        if (!result.response.ok) {
            if ([401, 403].includes(result.response.status) || result.post?.detail === 'login_required') botbooruToken = '';
            throw new Error('BotBooru: ' + (result.post?.detail || result.response.status));
        }
        const post = result.post;
        const gallery = Array.isArray(post.mini_gallery?.images) ? post.mini_gallery.images : [];
        return {
            images: gallery.map(image => normalizeUrl(image.url || image.main_view_url, endpoint)).filter(Boolean),
        };
    }

    async function importEmbeddedImagesFromCurrentCharacter() {
        if (isDownloading) {
            return;
        }

        const galleryFolder = getGalleryFolderForCurrentCharacter();
        if (!galleryFolder) {
            toastr.warning('No character selected to import gallery into.');
            return;
        }

        const button = document.getElementById(EMBEDDED_BUTTON_ID);
        isDownloading = true;
        if (button instanceof HTMLElement) {
            button.classList.add('disabled');
            button.setAttribute('title', 'Importing embedded images...');
        }

        try {
            const avatarFile = getCurrentCharacterData()?.avatar;
            toastr.info('Scanning creator notes, description, greetings, and lorebook...');
            const [embeddedUrls, lorebookUrls] = await Promise.all([
                getEmbeddedImageUrlsForCurrentCharacter(), getCharacterLorebookImageUrls(),
            ]);
            const { resolveImageLinks } = await getGalleryTools();
            const { images: allUrls, failures } = await resolveImageLinks([...embeddedUrls, ...lorebookUrls]);
            if (failures.length) {
                console.warn('[WaifuAvatar] Unresolved gallery links:', failures);
                toastr.warning(`${failures.length} linked page(s) could not be read. ${failures[0]}`);
            }

            if (!allUrls.length) {
                toastr.info('No images found in creator notes, description, greetings, or lorebook.');
                return;
            }

            const { imported } = await importImageUrls(allUrls, galleryFolder, button);
            if (imported) refreshImportedGallery(avatarFile);
        } catch (error) {
            console.error('[WaifuAvatar] Embedded image import failed:', error);
            toastr.error(`Failed to import embedded images: ${error.message || error}`);
        } finally {
            isDownloading = false;
            if (button instanceof HTMLElement) {
                button.classList.remove('disabled');
                button.setAttribute('title', 'Import images and linked albums from creator notes, description, greetings, and lorebook');
            }
        }
    }

    function ensureGalleryButton() {
        const titleRow = document.querySelector('#description_div .flex-container.alignitemscenter');
        if (!(titleRow instanceof HTMLElement)) {
            return;
        }

        let button = document.getElementById(BUTTON_ID);
        if (!(button instanceof HTMLDivElement)) {
            button = document.createElement('div');
            button.id = BUTTON_ID;
            button.className = 'menu_button menu_button_icon';
            button.innerHTML = '<i class="fa-solid fa-images"></i><span>Import Gallery</span>';
            button.setAttribute('title', 'Import Chub or BotBooru gallery');
            titleRow.appendChild(button);
        }

        if (button.dataset.bound !== 'true') {
            button.addEventListener('click', downloadGalleryFromCurrentCharacter);
            button.dataset.bound = 'true';
        }

        let embeddedButton = document.getElementById(EMBEDDED_BUTTON_ID);
        if (!(embeddedButton instanceof HTMLDivElement)) {
            embeddedButton = document.createElement('div');
            embeddedButton.id = EMBEDDED_BUTTON_ID;
            embeddedButton.className = 'menu_button menu_button_icon';
            embeddedButton.innerHTML = '<i class="fa-solid fa-file-image"></i><span>Import Embedded Images</span>';
            embeddedButton.setAttribute('title', 'Import images and linked albums from creator notes, description, greetings, and lorebook');
            titleRow.appendChild(embeddedButton);
        }

        if (embeddedButton.dataset.bound !== 'true') {
            embeddedButton.addEventListener('click', importEmbeddedImagesFromCurrentCharacter);
            embeddedButton.dataset.bound = 'true';
        }

        const hasCharacter = Boolean(getCurrentCharacterData());
        button.style.display = hasCharacter ? '' : 'none';
        embeddedButton.style.display = hasCharacter ? '' : 'none';
        document.getElementById('wacg-import-botbooru-btn')?.remove();
    }

    const syncAllDebounced = debounce(() => {
        syncWaifuAvatar();
        ensureGalleryButton();
    }, 120);

    function init() {
        const context = getContextSafe();
        if (!context) {
            window.setTimeout(init, 400);
            return;
        }

        console.info(`[WaifuAvatar] extension loaded v${EXT_VERSION}`);

        syncWaifuAvatar();
        ensureGalleryButton();
        window.setTimeout(syncAllDebounced, 250);
        window.setTimeout(syncAllDebounced, 1000);

        if (context.eventSource && context.eventTypes) {
            const watchEvents = [
                context.eventTypes.SETTINGS_UPDATED,
                context.eventTypes.CHAT_CHANGED,
                context.eventTypes.MESSAGE_RECEIVED,
                context.eventTypes.MESSAGE_SWIPED,
                context.eventTypes.MESSAGE_EDITED,
                context.eventTypes.GROUP_UPDATED,
                context.eventTypes.MOVABLE_PANELS_RESET,
                context.eventTypes.CHARACTER_PAGE_LOADED,
                context.eventTypes.CHARACTER_EDITED,
            ].filter(Boolean);

            for (const evt of watchEvents) {
                context.eventSource.on(evt, syncAllDebounced);
            }
        }

        $(document).on('change', '#waifuMode', syncAllDebounced);
        $(window).on('resize', syncAllDebounced);

        if (avatarIntervalId === null) {
            avatarIntervalId = window.setInterval(syncAllDebounced, POLL_INTERVAL_MS);
        }
    }

    $(document).ready(init);
})();
