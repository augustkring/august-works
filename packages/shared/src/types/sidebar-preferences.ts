export interface SidebarOrderPreference {
  orderedIds: string[];
  updatedAt: Date | null;
}

export interface PreferredCoworkerPreference {
  agentId: string | null;
  updatedAt: Date | null;
}
