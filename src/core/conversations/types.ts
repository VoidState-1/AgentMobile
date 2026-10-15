export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  titleSource: 'auto' | 'manual';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}
export interface ConversationDraft {
  text: string;
  attachment?: string;
  revision: number;
}
export interface ConversationState {
  schemaVersion: 1;
  revision: number;
  conversations: Conversation[];
  selected: Record<string, string>;
  drafts: Record<string, ConversationDraft>;
}
export const emptyConversationState = (): ConversationState => ({
  schemaVersion: 1,
  revision: 0,
  conversations: [],
  selected: {},
  drafts: {},
});
