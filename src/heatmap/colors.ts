/**
 * Color utilities for the token usage heatmap.
 * Maps normalized intensity values (0.0–1.0) to a color scale
 * ranging from cool blue (low usage) to red (high usage).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Complete set of colors for a single heatmap decoration */
export interface HeatmapColorSet {
  /** Background highlight color */
  backgroundColor: string;
  /** Left border color for emphasis */
  borderColor: string;
  /** Gutter indicator color */
  gutterColor: string;
  /** Human-readable intensity label */
  label: string;
}

// ─── Color Scale Definition ──────────────────────────────────────────────────

/**
 * Color band definition. Each band covers an intensity range
 * and maps to an RGBA base color.
 */
interface ColorBand {
  /** Minimum intensity for this band (inclusive) */
  min: number;
  /** Maximum intensity for this band (exclusive, except last band) */
  max: number;
  /** RGBA color components [r, g, b] — alpha is applied separately */
  rgb: [number, number, number];
  /** Intensity label for this band */
  label: string;
}

/** Color bands ordered from low to high intensity */
const COLOR_BANDS: readonly ColorBand[] = [
  { min: 0.0, max: 0.1, rgb: [59, 130, 246], label: 'Low' },
  { min: 0.1, max: 0.3, rgb: [20, 184, 166], label: 'Low' },
  { min: 0.3, max: 0.5, rgb: [34, 197, 94], label: 'Medium' },
  { min: 0.5, max: 0.7, rgb: [234, 179, 8], label: 'High' },
  { min: 0.7, max: 0.85, rgb: [249, 115, 22], label: 'Very High' },
  { min: 0.85, max: 1.0, rgb: [239, 68, 68], label: 'Critical' },
] as const;

// ─── Color Functions ─────────────────────────────────────────────────────────

/**
 * Resolves the color band for a given intensity value.
 * @param intensity - Normalized value between 0.0 and 1.0
 * @returns The matching color band
 */
function resolveBand(intensity: number): ColorBand {
  const clamped = Math.max(0, Math.min(1, intensity));
  for (const band of COLOR_BANDS) {
    if (clamped >= band.min && clamped < band.max) {
      return band;
    }
  }
  // intensity === 1.0 falls into the last band
  return COLOR_BANDS[COLOR_BANDS.length - 1];
}

/**
 * Formats an RGBA color string from RGB components and opacity.
 * @param rgb - [r, g, b] components (0–255)
 * @param opacity - Alpha value (0.0–1.0)
 * @returns CSS rgba() color string
 */
function rgba(rgb: [number, number, number], opacity: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`;
}

/**
 * Returns a full heatmap color set for a given intensity level.
 *
 * @param intensity - Normalized intensity value between 0.0 and 1.0,
 *   where 0.0 is lowest token usage and 1.0 is highest.
 * @param opacity - Background opacity (0.0–1.0). Border and gutter
 *   use slightly higher opacity for visibility.
 * @returns A complete color set for decorating the editor line.
 *
 * @example
 * ```ts
 * const colors = getHeatmapColor(0.75, 0.3);
 * // colors.backgroundColor = "rgba(249, 115, 22, 0.3)"
 * // colors.label = "Very High"
 * ```
 */
export function getHeatmapColor(intensity: number, opacity: number): HeatmapColorSet {
  const band = resolveBand(intensity);
  const clampedOpacity = Math.max(0, Math.min(1, opacity));

  return {
    backgroundColor: rgba(band.rgb, clampedOpacity),
    borderColor: rgba(band.rgb, Math.min(1, clampedOpacity + 0.3)),
    gutterColor: rgba(band.rgb, Math.min(1, clampedOpacity + 0.4)),
    label: band.label,
  };
}

/**
 * Returns a human-readable intensity label for a given intensity value.
 *
 * @param intensity - Normalized value between 0.0 and 1.0
 * @returns 'Low' | 'Medium' | 'High' | 'Very High' | 'Critical'
 */
export function getIntensityLabel(intensity: number): string {
  const band = resolveBand(intensity);
  return band.label;
}
