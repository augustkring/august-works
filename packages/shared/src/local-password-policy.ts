/** New local credentials only. Existing credentials retain native sign-in. */
export const LOCAL_PASSWORD_MIN_LENGTH = 15;
export const LOCAL_PASSWORD_MAX_LENGTH = 128;
// HTML and Better Auth measure UTF-16 units; the policy counts codepoints.
export const LOCAL_PASSWORD_MAX_UTF16_LENGTH = LOCAL_PASSWORD_MAX_LENGTH * 2;
export function hasValidNewLocalPasswordLength(password: string): boolean {
  if (password.length > LOCAL_PASSWORD_MAX_UTF16_LENGTH) return false;
  const length = [...password].length;
  return length >= LOCAL_PASSWORD_MIN_LENGTH && length <= LOCAL_PASSWORD_MAX_LENGTH;
}
