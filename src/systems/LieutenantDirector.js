// LieutenantDirector — the lightweight scheduler for the mid-segment LIEUTENANT
// mini-boss. Mirrors BossDirector's shape but far simpler: it fires exactly ONCE
// per boss-to-boss segment, roughly at the segment's midpoint, so a Lieutenant
// lands between full bosses without ever overlapping the boss setpiece.
//
// reset(segmentStart) is called at run start (0) and on every boss defeat, so in
// endless/gauntlet the Lieutenant keeps reappearing once per new segment. The
// `fired` one-shot guarantees a single Lieutenant even if a boss spawn is held
// and the segment stretches long.

import { BOSS, LIEUTENANT } from '../config/GameConfig.js';

export class LieutenantDirector {
    constructor() { this.reset(0); }

    reset(segmentStart) {
        this.segmentStart = segmentStart;
        this.fired = false;
        this.fireAt = segmentStart + BOSS.spawnInterval * (LIEUTENANT.fireFraction ?? 0.5);
    }

    // Returns true exactly once per segment, when the mid-segment time is reached.
    update(gameTime) {
        if (this.fired) return false;
        if (gameTime < this.fireAt) return false;
        this.fired = true;
        return true;
    }
}
