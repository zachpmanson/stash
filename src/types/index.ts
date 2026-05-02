export type ItemType = "image" | "url" | "text" | "file";

export type Folder = {
  id: string;
  name: string;
  icon: string;
  created_at: number;
  last_used_at: number;
  archived_at: number | null;
  item_count?: number;
};

export type SelectableFolder = Folder & {
  isSelected?: boolean;
};

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
