(function () {
    const EXT_VERSION = '1.0.9';
    const FALLBACK_WRAPPER_ID = 'wacg-vn-fallback-wrapper';
    const HOLDER_ID = 'wacg-vn-holder';
    const IMAGE_ID = 'wacg-vn-image';
    const LEFT_ZONE_ID = 'wacg-vn-zone-left';
    const RIGHT_ZONE_ID = 'wacg-vn-zone-right';
    const BUTTON_ID = 'wacg-download-gallery-btn';
    const EMBEDDED_BUTTON_ID = 'wacg-import-embedded-btn';
    const POLL_INTERVAL_MS = 1000;
    const CAROUSEL_STATE_KEY = 'waifu_avatar_carousel_state_v1';

    if (window.__wacgExtensionLoaded) {
        return;
    }
    window.__wacgExtensionLoaded = true;

    let avatarIntervalId = null;
    let isDownloading = false;
    let stSaveBase64AsFile = null;
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

    function parseChubPathFromUrl(url) {
        if (typeof url !== 'string' || !url.trim()) {
            return null;
        }

        const clean = url.trim();
        const directMatch = clean.match(/chub\.ai\/characters\/([^?#]+)/i);
        if (directMatch?.[1]) {
            return decodeURIComponent(directMatch[1]).replace(/^\/+/, '');
        }

        return null;
    }

    function getCurrentCharacterChubPath() {
        const character = getCurrentCharacterData();
        if (!character) {
            return null;
        }

        const fullPath = character?.data?.extensions?.chub?.full_path;
        if (typeof fullPath === 'string' && fullPath.trim()) {
            return fullPath.trim();
        }

        const sourceUrl = character?.data?.extensions?.source_url;
        return parseChubPathFromUrl(sourceUrl);
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
        const url = `https://api.chub.ai/api/characters/${encodeURI(chubPath)}?full=false`;
        const response = await fetch(url, { headers: getChubHeaders() });
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
            const response = await fetch(url, { headers: getChubHeaders() });
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
            return new URL(raw, window.location.origin).toString();
        } catch {
            return '';
        }
    }

    function getEmbeddedImageUrlsForCurrentCharacter() {
        const character = getCurrentCharacterData();
        if (!character) {
            return [];
        }

        const texts = [
            character.description || '',
            character.first_mes || '',
            ...(Array.isArray(character?.data?.alternate_greetings) ? character.data.alternate_greetings : []),
        ];

        const urls = texts.flatMap((text) => extractEmbeddedImageUrls(text));
        const normalized = urls.map(normalizeImageUrl).filter(Boolean);
        return [...new Set(normalized)];
    }

    async function uploadImageToStGallery(imageUrl, folderName, options = {}) {
        if (!stSaveBase64AsFile) {
            try {
                const utilsModule = await import('/scripts/utils.js');
                stSaveBase64AsFile = utilsModule.saveBase64AsFile;
            } catch (error) {
                throw new Error(`Failed to load ST upload helper: ${error?.message || error}`);
            }
        }

        if (typeof stSaveBase64AsFile !== 'function') {
            throw new Error('ST upload helper is unavailable');
        }
        const isDataUrl = String(imageUrl).startsWith('data:image/');
        let base64DataUrl = '';
        let base64Chunk = '';
        let rawFileName = options.filename || '';

        if (isDataUrl) {
            // For embedded data URLs in cards.
            const base64Part = String(imageUrl).split(',')[1] || '';
            base64Chunk = String(base64Part).replace(/\s+/g, '');
            if (!base64Chunk) {
                throw new Error('Embedded data URL contains no image payload');
            }
            base64DataUrl = `data:image/png;base64,${base64Chunk}`;
            rawFileName = rawFileName || `embedded-${Date.now()}.png`;
        } else {
            const responseHeaders = options.headers || {};
            const imageResponse = await fetch(imageUrl, { headers: responseHeaders });
            if (!imageResponse.ok) {
                throw new Error(`Failed to fetch gallery image (${imageResponse.status})`);
            }

            const imageBlob = await imageResponse.blob();
            const pngDataUrl = await blobToPngDataUrl(imageBlob);
            base64Chunk = String(pngDataUrl.split(',')[1] || '').replace(/\s+/g, '');
            if (!base64Chunk) {
                throw new Error('Failed to encode image as base64');
            }
            base64DataUrl = `data:image/png;base64,${base64Chunk}`;
            rawFileName = rawFileName || imageUrl.split('/').pop()?.split('?')[0] || `image-${Date.now()}.png`;
        }

        const payload = {
            image: base64DataUrl,
            ch_name: folderName,
            filename: rawFileName.replace(/\./g, '_'),
        };
        try {
            // Use ST's own helper to avoid request formatting/token mismatches.
            await stSaveBase64AsFile(base64Chunk, folderName, payload.filename, 'png');
        } catch (error) {
            console.warn('[WaifuAvatar] Upload failed', {
                details: String(error?.message || error),
                folderName,
                imageUrl,
                dataUrlHeader: base64DataUrl.split(',')[0],
                hasComma: base64DataUrl.includes(','),
                headerPreview: base64DataUrl.slice(0, 64),
                base64Length: (base64DataUrl.split(',')[1] || '').length,
                serverParseFormatPreview: base64DataUrl.split(',')[0].split(';')[0].split('/')[1],
                version: EXT_VERSION,
            });
            throw error;
        }
    }

    async function downloadGalleryFromCurrentCharacter() {
        if (isDownloading) {
            return;
        }

        const chubPath = getCurrentCharacterChubPath();
        if (!chubPath) {
            toastr.warning('No Chub source found on this character.');
            return;
        }
        const galleryFolder = getGalleryFolderForCurrentCharacter();
        if (!galleryFolder) {
            toastr.warning('No character selected to import gallery into.');
            return;
        }

        const button = document.getElementById(BUTTON_ID);
        isDownloading = true;
        if (button instanceof HTMLElement) {
            button.classList.add('disabled');
            button.setAttribute('title', 'Importing gallery...');
        }

        try {
            toastr.info('Fetching Chub gallery info...');
            const node = await fetchChubCharacterNode(chubPath);
            const cardId = node?.id;
            if (!cardId) {
                throw new Error('Chub card id was not found');
            }

            const galleryNodes = await fetchAllGalleryNodes(cardId);
            const imageUrls = galleryNodes
                .map((nodeItem) => nodeItem?.primary_image_path)
                .filter((url) => typeof url === 'string' && url.length > 0);

            if (!imageUrls.length) {
                toastr.info('No gallery images found for this character.');
                return;
            }

            toastr.info(`Importing ${imageUrls.length} image(s) into SillyTavern gallery...`);
            let importedCount = 0;
            for (let i = 0; i < imageUrls.length; i++) {
                try {
                    await uploadImageToStGallery(imageUrls[i], galleryFolder);
                    importedCount++;
                } catch (error) {
                    console.warn('[WaifuAvatar] Skipped gallery image import:', error);
                }
            }

            if (importedCount === 0) {
                toastr.warning('No gallery images could be imported.');
            } else {
                toastr.success(`Imported ${importedCount} image(s) into gallery folder "${galleryFolder}".`);
            }
        } catch (error) {
            console.error('[WaifuAvatar] Gallery import failed:', error);
            toastr.error(`Failed to import Chub gallery: ${error.message || error}`);
        } finally {
            isDownloading = false;
            if (button instanceof HTMLElement) {
                button.classList.remove('disabled');
                button.setAttribute('title', 'Import Chub Gallery');
            }
        }
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

        const embeddedUrls = getEmbeddedImageUrlsForCurrentCharacter();
        if (!embeddedUrls.length) {
            toastr.info('No embedded images found in description or greetings.');
            return;
        }

        const button = document.getElementById(EMBEDDED_BUTTON_ID);
        isDownloading = true;
        if (button instanceof HTMLElement) {
            button.classList.add('disabled');
            button.setAttribute('title', 'Importing embedded images...');
        }

        try {
            toastr.info(`Importing ${embeddedUrls.length} embedded image(s) into SillyTavern gallery...`);
            let importedCount = 0;
            for (let i = 0; i < embeddedUrls.length; i++) {
                try {
                    await uploadImageToStGallery(
                        embeddedUrls[i],
                        galleryFolder,
                        { filename: `embedded-${String(i + 1).padStart(3, '0')}.png` },
                    );
                    importedCount++;
                } catch (error) {
                    console.warn('[WaifuAvatar] Skipped embedded image import:', error);
                }
            }

            if (importedCount === 0) {
                toastr.warning('No embedded images could be imported.');
            } else {
                toastr.success(`Imported ${importedCount} embedded image(s) into "${galleryFolder}".`);
            }
        } catch (error) {
            console.error('[WaifuAvatar] Embedded image import failed:', error);
            toastr.error(`Failed to import embedded images: ${error.message || error}`);
        } finally {
            isDownloading = false;
            if (button instanceof HTMLElement) {
                button.classList.remove('disabled');
                button.setAttribute('title', 'Import embedded images from description and greetings');
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
            button.innerHTML = '<i class="fa-solid fa-images"></i><span>Import Chub Gallery</span>';
            button.setAttribute('title', 'Import Chub Gallery');
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
            embeddedButton.setAttribute('title', 'Import embedded images from description and greetings');
            titleRow.appendChild(embeddedButton);
        }

        if (embeddedButton.dataset.bound !== 'true') {
            embeddedButton.addEventListener('click', importEmbeddedImagesFromCurrentCharacter);
            embeddedButton.dataset.bound = 'true';
        }

        const chubPath = getCurrentCharacterChubPath();
        button.style.display = chubPath ? '' : 'none';
        embeddedButton.style.display = getCurrentCharacterData() ? '' : 'none';
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
