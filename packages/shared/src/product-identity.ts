/** Customer presentation only. Deployment trust, origins and permissions are
 * validated independently. Null legal facts require an accountable operator. */
export const PRODUCT_IDENTITY = {
  productName: "Blentera",
  productShortName: "Blentera",
  legalEntityName: null,
  legalEntityRegistration: null,
  legalEntityAddress: null,
  primaryWebsiteUrl: "https://blentera.com",
  appOrigin: "https://app.blentera.com",
  docsOrigin: "https://docs.blentera.com",
  statusOrigin: "https://status.blentera.com",
  trustOrigin: "https://trust.blentera.com",
  primaryContactEmail: "hello@blentera.com",
  contactAliases: [],
  emailCatchAllEnabled: false,
  supportEmail: "support@blentera.com",
  securityEmail: "security@blentera.com",
  privacyEmail: "privacy@blentera.com",
  transactionalSenderName: "Blentera",
  transactionalSenderEmail: "notifications@blentera.com",
  legalUrls: { terms: null, privacy: null, dpa: null, acceptableUse: null, subprocessors: null },
} as const;

export type ProductIdentity = typeof PRODUCT_IDENTITY;
