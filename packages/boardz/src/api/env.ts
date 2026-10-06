/** The hosted Boardsesh API. Override with EXPO_PUBLIC_BACKEND_URL for a local backend. */
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'https://ws.boardsesh.com';

/** The Boardsesh website, which also serves the board photos. */
export const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://www.boardsesh.com';

/**
 * Boardsesh's account settings, in its web app. Deleting a Boardsesh account
 * happens there; Boardz links to it from Settings, as the App Store requires.
 */
export const ACCOUNT_SETTINGS_URL = 'https://app.boardsesh.com/settings';
