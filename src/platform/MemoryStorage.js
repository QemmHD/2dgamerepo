// DOM-free Storage-shaped backend. Each instance owns an empty private map;
// it never samples, copies, or falls back to a browser profile.
export class MemoryStorage {
    #values = new Map();
    #writes = 0;

    get length() { return this.#values.size; }
    // Match the existing tools backend: count mutation API calls, including
    // removals of absent keys and clearing an already empty store.
    get writes() { return this.#writes; }

    key(index) {
        const offset = Number(index) >>> 0;
        return [...this.#values.keys()][offset] ?? null;
    }

    getItem(key) { return this.#values.get(String(key)) ?? null; }

    setItem(key, value) {
        this.#values.set(String(key), String(value));
        this.#writes += 1;
    }

    removeItem(key) {
        this.#values.delete(String(key));
        this.#writes += 1;
    }

    clear() {
        this.#values.clear();
        this.#writes += 1;
    }
}
