const UNIT_TOKEN_RE = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(?:tokens?|tok)$/i;
const AMBIGUOUS_UNIT_RE = /^\d+(?:\.\d+)?\s*[kKmM]$/;
export function parseTokenCount(input) {
    if (input === null || input === undefined || typeof input === 'boolean')
        return null;
    if (typeof input === 'number') {
        if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0)
            return null;
        return { value: input, raw: String(input), ambiguous: false };
    }
    if (typeof input !== 'string')
        return null;
    const raw = input.trim();
    if (raw.length === 0)
        return null;
    if (/^\d+$/.test(raw)) {
        const value = Number(raw);
        return Number.isSafeInteger(value) ? { value, raw, ambiguous: false } : null;
    }
    const tokenMatch = UNIT_TOKEN_RE.exec(raw);
    if (tokenMatch !== null) {
        const value = Number(tokenMatch[1].replace(/,/g, ''));
        return Number.isSafeInteger(value) ? { value, raw, ambiguous: false } : null;
    }
    if (AMBIGUOUS_UNIT_RE.test(raw)) {
        return { value: null, raw, ambiguous: true };
    }
    return null;
}
//# sourceMappingURL=token-count.js.map