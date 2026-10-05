export interface CoreStewardSummary {
  companyId: string;
  asOf: string;
  ownReadinessFindings: number;
  responsibilities: Array<{
    domain:
      | "foundation"
      | "memory"
      | "evaluation"
      | "governance"
      | "coordination";
    consumer: string;
    authority: string;
  }>;
}
