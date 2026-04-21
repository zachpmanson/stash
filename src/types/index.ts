export type ItemType = "image" | "url" | "text" | "file";

export type Folder = {
  id: string;
  name: string;
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
  folder_ids?: string[];
}

export interface LinkPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
}
