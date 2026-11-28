/**
 * What a dashboard read hands back (docs/06 T-3-b, fixtures U-07 and U-08).
 *
 * The two halves of a dashboard are two different questions about the same records, and they age
 * differently: the curve is a minute-by-minute fold of finished requests, the table is the last
 * few of those requests one at a time. The page needs both on one tick, so the endpoint answers
 * one payload -- and this type exists to say out loud that the second half can be shorter than the
 * first without anything being wrong.
 */
/** How many minutes the curve covers: an hour, the finest window the counters can honestly fill. */
export const READING_MINUTES = 60;
/** How many rows the table shows. A screenful and a half, so the table has something to scroll. */
export const READING_ROWS = 40;
//# sourceMappingURL=reading.js.map