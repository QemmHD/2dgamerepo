// Imported world textures (PART 8 of the art pipeline).
//
// Real CC0 photographic ground textures from Poly Haven, downsized to small
// seamless tiles and used as the world floor. They flow through the SAME
// per-biome recolor the procedural ground used (MapRenderer paints a biome
// groundFill + colour grade OVER the tile), so one source texture reads as
// forest dirt, frost, ash, or sand depending on the active map.
//
// Robustness mirrors LpcSprites: loadWorldTextures() NEVER rejects. If the
// PNG fails to load (offline, missing on the deploy), getGroundTexture()
// returns null and MapRenderer falls back to the procedural ground tile — the
// game always has a floor.

const TEXTURES = {
    ground_forest: { file: 'ground_forest.png' },
};

const cache = new Map();   // id → HTMLCanvasElement
let loaded = false;

function texUrl(file) {
    return new URL(`./textures/${file}`, import.meta.url).href;
}

function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// Bake the decoded image into a canvas so callers get a uniform,
// createPattern-friendly source (and so it composes with the recolor util if
// we ever tint a texture directly).
function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
}

// Load every world texture. Resolves (never rejects) once all attempts settle.
// Call once at boot. Returns true if at least one texture loaded.
export async function loadWorldTextures() {
    if (loaded) return true;
    const ids = Object.keys(TEXTURES);
    const imgs = await Promise.all(ids.map((id) => loadImage(texUrl(TEXTURES[id].file))));
    let anyOk = false;
    ids.forEach((id, i) => {
        if (!imgs[i]) return; // leave uncached → getGroundTexture falls back
        cache.set(id, toCanvas(imgs[i]));
        anyOk = true;
    });
    loaded = true;
    return anyOk;
}

// The seamless ground tile canvas, or null if it failed to load (caller falls
// back to the procedural tile).
export function getGroundTexture() {
    return cache.get('ground_forest') ?? null;
}
