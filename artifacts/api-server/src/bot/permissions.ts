export const BOT_OWNER_IDS = [
  "1483135478923399258",
  "1502364479739007037",
];

export const SHUTDOWN_OWNER_ID = "1502364479739007037";
export const VOUCH_ROLE_ID = "1535983891054067742";

export function isBotOwner(userId: string): boolean {
  return BOT_OWNER_IDS.includes(userId);
}
