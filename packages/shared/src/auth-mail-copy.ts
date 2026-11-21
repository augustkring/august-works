/** Versioned copy for authentication messages sent by the native email outbox. */
export const AUTH_MAIL_COPY_VERSION = 1 as const;

export const authMailCopy = {
  en: {
    verificationSubject: "Verify your {{productName}} email",
    verificationMessage: "Confirm your email to continue setting up your organization.",
    resetSubject: "Reset your {{productName}} password",
    resetMessage: "Use this link to reset your password. If you did not request this, you can ignore this email.",
  },
  da: {
    verificationSubject: "Bekræft din e-mailadresse til {{productName}}",
    verificationMessage: "Bekræft din e-mail for at fortsætte opsætningen af din organisation.",
    resetSubject: "Nulstil din adgangskode til {{productName}}",
    resetMessage: "Brug dette link til at nulstille din adgangskode. Hvis du ikke har anmodet om dette, kan du ignorere denne e-mail.",
  },
} as const;

export type AuthMailLocale = keyof typeof authMailCopy;

export function isAuthMailLocale(value: unknown): value is AuthMailLocale {
  return value === "en" || value === "da";
}

export function renderAuthMailCopy(
  locale: AuthMailLocale,
  purpose: "verification" | "password_reset",
  productName: string,
) {
  const copy = authMailCopy[locale];
  const subject = purpose === "verification" ? copy.verificationSubject : copy.resetSubject;
  return {
    subject: subject.replace("{{productName}}", productName),
    message: purpose === "verification" ? copy.verificationMessage : copy.resetMessage,
  };
}
