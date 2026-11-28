/**
 * The detail table's rows (docs/06 T-3-b, fixtures U-05 and U-07).
 *
 * One row per finished request, newest first, and every figure in it is either something a request
 * recorded or nothing at all -- never a placeholder. That is the whole content of this module: the
 * sort rule has to survive a null key, and the key column has to survive being published.
 *
 * U-07 is why sorting lives here instead of in a JSX `.sort()`: a column whose value can be unknown
 * cannot be ordered by treating unknown as zero, because "no balance was ever read" would then sort
 * above "the balance is nearly gone" -- the one order a reader must never be shown by accident. An
 * unknown sorts to the end of the column and stays there, whatever direction the reader picks.
 *
 * Nothing here reads a clock or a store. Rows in, rows out.
 */
import type { MetricsEvent } from './contract.js';
/** One line of the table under 07's shape, with nothing invented to fill a gap. */
export interface DetailRow {
    readonly atMs: number;
    readonly requestId: string;
    readonly accountAlias: string;
    /** The masked key: the only form of a key that may leave the store (docs/07 U-05). */
    readonly keyIdMasked: string;
    readonly modelId: string;
    readonly status: number;
    readonly rateKind?: string;
    /** Null when the event carried no token figures. Zero would be a measurement; this is not. */
    readonly promptTokens: number | null;
    readonly completionTokens: number | null;
    readonly latencyMs: number;
    /** 1-based, as the scheduler counts attempts. */
    readonly attempt: number;
    readonly concurrencyAtSend: number;
    /** Queue wait, or null when the request never waited -- an absence, not a fast zero. */
    readonly queueWaitMs: number | null;
}
/** Newest first: the table answers "what just happened", so the last event is the top row. */
export declare function rowsOf(events: readonly MetricsEvent[], limit?: number): readonly DetailRow[];
/**
 * Sort rows by one of the numeric columns, unknowns last in both directions (fixture U-07).
 *
 * `desc` is which way the numbers go. The unknowns do not go with them: a null is not a small number
 * and not a large one, it is the absence of an answer to "how much", so it neither leads nor bottoms
 * out the list -- it sits after whichever end the reader asked to start from.
 */
export declare function sortRows(rows: readonly DetailRow[], column: 'promptTokens' | 'completionTokens' | 'latencyMs' | 'queueWaitMs', desc: boolean): readonly DetailRow[];
//# sourceMappingURL=amd-table.d.ts.map