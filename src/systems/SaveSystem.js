// localStorage-backed meta-progression save.
//
// One key for the whole game. On boot, _loadOrDefault validates whatever
// was stored and falls back to defaults for missing fields or corrupted
// JSON. All public methods are no-ops on localStorage failures (private
// mode, exceeded quota, blocked storage) so the game never crashes.

const SAVE_KEY = 'monkey-survivor:save:v1';

function defaultData() {
    return {
        totalCoins: 0,
        upgrades: {
            maxHp: 0,
            damage: 0,
            moveSpeed: 0,
            xpGain: 0,
            pickupRange: 0,
            startingCoins: 0,
            rerolls: 0,
            banish: 0,
        },
        // Lifetime + best-run records, surfaced on the start screen and used
        // for the game-over "NEW BEST!" banner.
        stats: {
            bestTime: 0,
            bestWave: 0,
            bestLevel: 0,
            bestKills: 0,
            bestBosses: 0,
            runs: 0,
            totalKills: 0,
            totalBosses: 0,
            totalCoinsEarned: 0,
        },
        settings: {
            screenShake: true,
        },
        version: 2,
    };
}

export class SaveSystem {
    constructor() {
        this.available = this._probe();
        this.data = this._loadOrDefault();
    }

    _probe() {
        try {
            const key = '__monkey_survivor_probe__';
            localStorage.setItem(key, '1');
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.warn('[SaveSystem] localStorage unavailable; running in memory-only mode');
            return false;
        }
    }

    _loadOrDefault() {
        if (!this.available) return defaultData();
        let raw = null;
        try {
            raw = localStorage.getItem(SAVE_KEY);
        } catch (e) {
            console.warn('[SaveSystem] read failed', e);
            return defaultData();
        }
        if (!raw) return defaultData();
        try {
            const parsed = JSON.parse(raw);
            return this._validate(parsed);
        } catch (e) {
            console.warn('[SaveSystem] corrupted save, resetting', e);
            return defaultData();
        }
    }

    _validate(data) {
        const def = defaultData();
        if (typeof data !== 'object' || !data) return def;
        const totalCoins = Number.isFinite(data.totalCoins) && data.totalCoins >= 0
            ? Math.floor(data.totalCoins)
            : 0;
        // Migration is implicit: any key missing from an older save (e.g. a
        // v1 save with no `rerolls`, `stats`, or `settings`) keeps its
        // default, so old saves load cleanly.
        const upgrades = { ...def.upgrades };
        if (data.upgrades && typeof data.upgrades === 'object') {
            for (const key of Object.keys(upgrades)) {
                const v = data.upgrades[key];
                if (Number.isFinite(v) && v >= 0) upgrades[key] = Math.floor(v);
            }
        }
        const stats = { ...def.stats };
        if (data.stats && typeof data.stats === 'object') {
            for (const key of Object.keys(stats)) {
                const v = data.stats[key];
                if (Number.isFinite(v) && v >= 0) stats[key] = Math.floor(v);
            }
        }
        const settings = { ...def.settings };
        if (data.settings && typeof data.settings === 'object') {
            if (typeof data.settings.screenShake === 'boolean') {
                settings.screenShake = data.settings.screenShake;
            }
        }
        return { totalCoins, upgrades, stats, settings, version: 2 };
    }

    save() {
        if (!this.available) return;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.warn('[SaveSystem] write failed', e);
        }
    }

    addCoins(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.data.totalCoins += Math.floor(amount);
        this.save();
    }

    spendCoins(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return false;
        if (this.data.totalCoins < amount) return false;
        this.data.totalCoins -= Math.floor(amount);
        this.save();
        return true;
    }

    getUpgradeLevel(id) {
        return this.data.upgrades[id] ?? 0;
    }

    incrementUpgrade(id) {
        if (!(id in this.data.upgrades)) return false;
        this.data.upgrades[id] += 1;
        this.save();
        return true;
    }

    // Fold a finished run into lifetime totals + best-run records. Returns
    // a record of which "best" fields were newly beaten this run so the
    // game-over screen can flag them with a NEW BEST banner.
    recordRun(summary) {
        const s = this.data.stats || (this.data.stats = {
            bestTime: 0, bestWave: 0, bestLevel: 0, bestKills: 0, bestBosses: 0,
            runs: 0, totalKills: 0, totalBosses: 0, totalCoinsEarned: 0,
        });
        const beat = { time: false, wave: false, level: false, kills: false };

        const time = Math.floor(summary.time ?? 0);
        const wave = Math.floor(summary.finalWave ?? 0);
        const level = Math.floor(summary.level ?? 0);
        const kills = Math.floor(summary.kills ?? 0);
        const bosses = Math.floor(summary.bossesDefeated ?? 0);
        const coins = Math.floor(summary.coinsEarned ?? 0);

        if (time > s.bestTime) { s.bestTime = time; beat.time = true; }
        if (wave > s.bestWave) { s.bestWave = wave; beat.wave = true; }
        if (level > s.bestLevel) { s.bestLevel = level; beat.level = true; }
        if (kills > s.bestKills) { s.bestKills = kills; beat.kills = true; }
        if (bosses > s.bestBosses) s.bestBosses = bosses;

        s.runs += 1;
        s.totalKills += kills;
        s.totalBosses += bosses;
        s.totalCoinsEarned += Math.max(0, coins);

        this.save();
        return beat;
    }

    getSetting(key) {
        return this.data.settings ? this.data.settings[key] : undefined;
    }

    setSetting(key, value) {
        if (!this.data.settings) this.data.settings = {};
        this.data.settings[key] = value;
        this.save();
    }

    reset() {
        this.data = defaultData();
        this.save();
    }
}
