// Tools-only backend and write instrumentation; the real SaveSystem owns rules.
export function createMemoryStorage() {
    const values = new Map();
    let writes = 0;
    return {
        get length() { return values.size; },
        get writes() { return writes; },
        key(index) { return [...values.keys()][Number(index) >>> 0] ?? null; },
        getItem(key) { return values.get(String(key)) ?? null; },
        setItem(key, value) { values.set(String(key), String(value)); writes++; },
        removeItem(key) { values.delete(String(key)); writes++; },
        clear() { values.clear(); writes++; },
    };
}
