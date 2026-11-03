export const HELP_CENTER_NAVIGATION_ENTRY_ID = "help-center-navigation-entry";
export const HELP_CENTER_UTILITY_ENTRY_ID = "help-center-utility-entry";

export function isHelpCenterEntryId(value: unknown): value is
  | typeof HELP_CENTER_NAVIGATION_ENTRY_ID
  | typeof HELP_CENTER_UTILITY_ENTRY_ID {
  return value === HELP_CENTER_NAVIGATION_ENTRY_ID || value === HELP_CENTER_UTILITY_ENTRY_ID;
}
