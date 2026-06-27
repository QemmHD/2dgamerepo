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
        },
        version: 1,
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
        const upgrades = { ...def.upgrades };
        if (data.upgrades && typeof data.upgrades === 'object') {
            for (const key of Object.keys(upgrades)) {
                const v = data.upgrades[key];
                if (Number.isFinite(v) && v >= 0) upgrades[key] = Math.floor(v);
            }
        }
        return { totalCoins, upgrades, version: 1 };
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

    reset() {
        this.data = defaultData();
        this.save();
    }
}
