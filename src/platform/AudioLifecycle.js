// The boot shell owns these six hooks, not AudioSystem or Game. Disposing the
// subscription stops gesture/focus callbacks but never disposes borrowed audio.
export function installAudioLifecycle(game, {
    windowTarget = typeof window !== 'undefined' ? window : null,
    documentTarget = typeof document !== 'undefined' ? document : null,
} = {}) {
    let disposed = false;
    const subscriptions = [];
    const cleanup = () => {
        if (disposed) return;
        disposed = true;
        for (const [target, type, callback, capture] of subscriptions.splice(0)) {
            target.removeEventListener(type, callback, capture);
        }
    };
    const listen = (target, type, callback, options = false) => {
        if (!target?.addEventListener) return;
        // Register the remover first: an instrumented host may attach then throw.
        subscriptions.push([target, type, callback,
            typeof options === 'boolean' ? options : !!options.capture]);
        target.addEventListener(type, callback, options);
    };
    // Keep recovery installed for Safari's later interrupted AudioContexts.
    const unlockAudio = () => {
        if (!disposed) void game.audio.unlock();
    };
    const syncAudioPause = () => {
        if (disposed) return;
        const held = game.screen === 'gameplay' && (documentTarget?.hidden || game.paused);
        game.audio.setPaused(held);
    };
    const blurAudio = () => {
        if (!disposed && game.screen === 'gameplay') game.audio.setPaused(true);
    };
    try {
        listen(windowTarget, 'pointerdown', unlockAudio, { capture: true, passive: true });
        listen(windowTarget, 'touchstart', unlockAudio, { capture: true, passive: true });
        listen(windowTarget, 'keydown', unlockAudio, { capture: true, passive: true });
        listen(windowTarget, 'blur', blurAudio);
        listen(windowTarget, 'focus', syncAudioPause);
        listen(documentTarget, 'visibilitychange', syncAudioPause);
    } catch (error) {
        cleanup();
        throw error;
    }
    return cleanup;
}
