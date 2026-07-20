export type ItemType = "image" | "url" | "text" | "file";

export type Folder = {
  id: string;
  name: string;
  icon: string;
  created_at: number;
  last_used_at: number;
  archived_at: number | null;
  item_count?: number;
  total_text_length?: number;
};

export type SelectableFolder = Folder & {
  isSelected?: boolean;
};

type TimeEstimate = {
  minutes: number;
  label: string;
};

export function estimateFolderReadTime(totalTextLength: number | undefined): TimeEstimate | null {
  if (!totalTextLength) return null;
  // Average reading speed: ~200 words per minute
  // Average character per word: ~5
  const avgWordsPerMinute = 200;
  const avgCharsPerWord = 5;
  const words = totalTextLength / avgCharsPerWord;
  const minutes = words / avgWordsPerMinute;
  
  if (minutes < 1) return { minutes: 0, label: "<1 min read" };
  if (minutes < 60) return { minutes: Math.round(minutes), label: `${Math.round(minutes)} min read` };
  const hours = minutes / 60;
  if (hours < 24) return { minutes: Math.round(minutes), label: `${Math.round(hours)} hr read` };
  const days = hours / 24;
  return { minutes: Math.round(minutes), label: `${Math.round(days)} days read` };
}

export interface StashItem {
  id: string;
  type: ItemType;
  uri: string;
  title: string | null;
  description: string | null;
  favicon_url: string | null;
  thumbnail_path: string | null;
  mime_type: string | null;
  created_at: number;
  archived_at: number | null;
  article_text: string | null;
  article_html: string | null;
  listened_percent?: number;
  folder_ids?: string[];
}

export type TextSubstitution = {
  id: string;
  find: string;
  replace: string;
  case_sensitive: 0 | 1;
  created_at: number;
};

export interface LinkPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
}
