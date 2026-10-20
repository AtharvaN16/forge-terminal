/**
 * How much the notes say (the Detail pill on Transcribe to, `--detail`).
 * Standard is what the helper was measured at; brief and detailed change the
 * part size, the points per part and the summary's length. Pure data.
 */
export const DETAILS = ['brief', 'standard', 'detailed'] as const
export type Detail = (typeof DETAILS)[number]

export const DEFAULT_DETAIL: Detail = 'standard'

export const detailLabel = (detail: Detail): string =>
  `${detail.slice(0, 1).toUpperCase()}${detail.slice(1)}`
