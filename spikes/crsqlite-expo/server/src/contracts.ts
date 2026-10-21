/** Browser-safe DTOs only. Never add local paths, media bytes or raw HTML here. */
export type WebFolder = {
  id: string;
  name: string;
  icon: string;
  created_at: number;
  archived_at: number | null;
  layout: string;
};
export type WebItem = {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  description: string | null;
  article_text: string | null;
  created_at: number;
  archived_at: number | null;
  folderIds: string[];
  mediaUnavailable: boolean;
  /** Bounded plaintext preview; list responses never include full content. */
  excerpt?: string | null;
  domain?: string | null;
};
export type WebItemPage = { items: WebItem[]; hasMore: boolean };
export type Created = { id: string };
