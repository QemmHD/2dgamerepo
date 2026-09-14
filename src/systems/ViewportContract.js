// Presentation adapters only. Renderer.resize owns sizing; Camera.apply owns
// the visual world transform. Neither input nor simulation uses these helpers.

export function snapshotCamera(camera) {
    const matrix = [1, 0, 0, 1, 0, 0];
    const multiply = (a, b, c, d, e, f) => {
        const [ma, mb, mc, md, me, mf] = matrix;
        matrix[0] = ma * a + mc * b; matrix[1] = mb * a + md * b;
        matrix[2] = ma * c + mc * d; matrix[3] = mb * c + md * d;
        matrix[4] = ma * e + mc * f + me; matrix[5] = mb * e + md * f + mf;
    };
    // Execute the real Camera transform, rather than maintaining a second copy
    // of its rotation/zoom/shake order in an experimental renderer.
    camera.apply({
        translate(x, y) { multiply(1, 0, 0, 1, x, y); },
        scale(x, y) { multiply(x, 0, 0, y, 0, 0); },
        rotate(angle) { const c = Math.cos(angle), s = Math.sin(angle); multiply(c, s, -s, c, 0, 0); },
    });
    return { center: { x: camera.x, y: camera.y }, zoom: camera.zoom,
        shake: { x: camera.shakeOffsetX, y: camera.shakeOffsetY, rotation: camera.shakeAngle }, matrix };
}

export function applyCameraToPhaser(cameraSnapshot, phaserCamera, viewport) {
    const [a, b, c, d, e, f] = cameraSnapshot.matrix.map(value => value * viewport.logicalToBackingScale);
    const originX = viewport.backingWidth / 2, originY = viewport.backingHeight / 2;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || determinant <= 0) throw new Error('Invalid presentation camera matrix');
    const zoom = Math.hypot(a, b), rotation = Math.atan2(b, a);
    // Pinned Phaser 4.2.1 Camera.preRender includes scroll IN its view matrix:
    // T(origin) R S T(-scroll-origin). Solve that transform for scroll. This
    // preserves even Renderer's subpixel backing-rounding offset exactly.
    const scrollX = (d * (originX - e) - c * (originY - f)) / determinant - originX;
    const scrollY = (-b * (originX - e) + a * (originY - f)) / determinant - originY;
    phaserCamera.setViewport(0, 0, viewport.backingWidth, viewport.backingHeight);
    phaserCamera.setOrigin(0.5, 0.5);
    phaserCamera.setZoom(zoom);
    phaserCamera.setRotation(rotation);
    phaserCamera.setScroll(scrollX, scrollY);
    phaserCamera.roundPixels = false;
    phaserCamera.inputEnabled = false;
    return { scrollX, scrollY, zoom, rotation };
}

export function projectWorldToBacking(cameraSnapshot, viewport, x, y) {
    const [a, b, c, d, e, f] = cameraSnapshot.matrix;
    const scale = viewport.logicalToBackingScale;
    return { x: (a * x + c * y + e) * scale, y: (b * x + d * y + f) * scale };
}

function stagePointToClient(viewport, x, y) {
    const rect = viewport.cssBounds;
    const dx = x - viewport.cssWidth / 2, dy = y - viewport.cssHeight / 2;
    return viewport.rotated
        ? { x: rect.x + rect.width / 2 - dy, y: rect.y + rect.height / 2 + dx }
        : { x: rect.x + rect.width / 2 + dx, y: rect.y + rect.height / 2 + dy };
}

// Exact inverse of the existing physical input mapping, for logical UI points.
export function logicalToClient(viewport, x, y) {
    return stagePointToClient(viewport, x * viewport.cssWidth / viewport.logicalWidth,
        y * viewport.cssHeight / viewport.logicalHeight);
}

// Actual raster placement includes integer backing-store rounding. Keep that
// distinction from input mapping instead of changing the production policy.
export function backingToClient(viewport, x, y) {
    return stagePointToClient(viewport, x * viewport.cssWidth / viewport.backingWidth,
        y * viewport.cssHeight / viewport.backingHeight);
}

export function projectWorldToClient(cameraSnapshot, viewport, x, y) {
    const point = projectWorldToBacking(cameraSnapshot, viewport, x, y);
    return backingToClient(viewport, point.x, point.y);
}
