import { CompanySkills as CanonicalCompanySkills } from "./CompanySkills";

/** Classic tabs, categories, folders and Studio remain available. Native
 * readers, draft/preview/install actions and policy denials have one owner. */
export function CompanySkills() {
  return <CanonicalCompanySkills presentation="classic" />;
}
