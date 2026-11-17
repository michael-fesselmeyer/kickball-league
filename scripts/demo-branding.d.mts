// Types for scripts/demo-branding.mjs, which node runs as plain JavaScript.

export declare const BRANDING_FILE: string;
export declare const PUBLIC_LOGO_DIR: string;
export declare const LOGO_MAX_HEIGHT: number;
export declare const LOGO_LARGE_SIDE: number;

export declare class BrandingError extends Error {}

export type Branding = {
  leagueName: string;
  shortName: string | null;
  /** The logo file's full path, or null. */
  logo: string | null;
  teams: string[];
};

export type PreparedLogo = { src: string; width: number; height: number };

export declare function loadBranding(dir: string): Branding | null;
export declare function brandingEnv(
  branding: Branding | null,
  logo?: PreparedLogo | null,
): Record<string, string>;
export declare function logoSize(
  size: { width?: number; height?: number },
  largeSide?: number | null,
): { width: number; height: number };
export declare function brandingKey(branding: Branding | null): string;
export declare function prepareLogo(
  branding: Branding | null,
  publicDir: string,
): Promise<PreparedLogo | null>;
