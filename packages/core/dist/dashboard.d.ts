/**
 * One hour of minutes as an SVG line, and the rows behind it (docs/06 T-3-b).
 *
 * Hand-drawn rather than pulled from a charting library: DSH's desktop renderer ships no echarts (or
 * any other), the profile's @deepseek-ai directory is empty, and a dashboard that is blank on an
 * install which merely lacks a dependency is worse than a dashboard with plainer lines. What is
 * needed is a viewBox, a polyline and axis text, all of which are SVG 1.1.
 *
 * The one rule this file refuses to break is the hole. A minute with no requests draws no point and
 * no segment: `trendOf()` already leaves `rate` null there, so the line is emitted per unbroken run
 * of minutes that actually happened. A painter that called `.toFixed()` on every bucket and drew
 * through the nulls would put a calm flat line over an hour nobody measured -- the exact claim
 * docs/07 U-08 exists to prevent -- and would look more convincing than no chart at all.
 */
import type { TrendPoint } from './amd-trend.js';
/** Plot box in viewBox units. The numbers are units, not pixels: CSS scales the whole figure. */
export declare const PLOT_WIDTH = 320;
export declare const PLOT_HEIGHT = 96;
export interface TrendFigure {
    readonly width: number;
    readonly height: number;
    /** Each entry is one unbroken stretch of minutes that had traffic; a gap between entries is a hole. */
    readonly lines: readonly string[];
    /** The minute labels worth printing, as [x, text] pairs. Sparse on purpose. */
    readonly axis: readonly {
        readonly x: number;
        readonly label: string;
    }[];
}
/**
 * The figure's parts, without a React in sight.
 *
 * Kept as data so the test can assert the shape the drawer depends on -- how many runs, where they
 * break, what the axis says -- instead of poking at JSX. A drawing bug and a data bug look the same
 * in a snapshot but not in these numbers.
 */
export declare function trendFigureOf(trend: readonly TrendPoint[], hourLabel: (atMs: number) => string): TrendFigure;
/**
 * Why the curve is not drawn on a fresh install, said on the page instead of as an empty box.
 *
 * Three absences look identical in an SVG -- no host answering, a host that has recorded nothing
 * yet, and an hour in which the pool really was idle -- and two of them are not the same claim. The
 * figure stays blank for all three; this sentence is what keeps the blank from speaking for them.
 */
export declare function trendNoteOf(answered: boolean, measured: number): string;
//# sourceMappingURL=dashboard.d.ts.map