// Copy a JSON value without getters, hidden fields, custom prototypes, or live
// aliases. Shared acyclic inputs become independent branches in the receipt.
export function detachReceipt(snapshot) {
    const ancestors = new Set();
    const copy = (value, path) => {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object') throw new TypeError(`Non-JSON receipt value at ${path}`);
        const array = Array.isArray(value);
        const prototype = Object.getPrototypeOf(value);
        if (array ? prototype !== Array.prototype
            : prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`Non-plain receipt value at ${path}`);
        }
        if (ancestors.has(value)) throw new TypeError(`Cyclic receipt value at ${path}`);
        ancestors.add(value);
        try {
            const descriptors = Object.getOwnPropertyDescriptors(value);
            const keys = Reflect.ownKeys(descriptors);
            if (keys.some((key) => typeof key !== 'string')) {
                throw new TypeError(`Symbol receipt key at ${path}`);
            }
            const result = array ? [] : {};
            const length = array ? descriptors.length.value : 0;
            if (array && (keys.length !== length + 1
                || keys.some((key) => key !== 'length'
                    && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)))) {
                throw new TypeError(`Sparse or extended receipt array at ${path}`);
            }
            for (const key of keys) {
                if (array && key === 'length') continue;
                const descriptor = descriptors[key];
                if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
                    throw new TypeError(`Accessor or hidden receipt field at ${path}[${JSON.stringify(key)}]`);
                }
                Object.defineProperty(result, key, {
                    value: copy(descriptor.value, `${path}[${JSON.stringify(key)}]`),
                    enumerable: true, configurable: true, writable: true,
                });
            }
            return result;
        } finally {
            ancestors.delete(value);
        }
    };
    return copy(snapshot, '$');
}
