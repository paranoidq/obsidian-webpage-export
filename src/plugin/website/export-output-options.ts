/**
 * What an export produces.
 * LongPage: one self-contained HTML file with hash navigation and a continuous
 *           reading fallback when scripts are unavailable.
 * Site:     the interactive single-file site (sidebar, search, client-side navigation).
 */
export enum ExportOutputMode
{
	LongPage = "long-page",
	Site = "site",
}

/** Presentation of a long page export. */
export enum LongPageStyle
{
	Mobile = "mobile",
	Desktop = "desktop",
}
