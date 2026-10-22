import React from "react";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  Bars3Icon,
  ChevronLeftIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  FolderIcon,
  LinkIcon,
  ListBulletIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlusIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";

const icons = {
  folder: FolderIcon,
  all: Squares2X2Icon,
  archive: ArchiveBoxIcon,
  plus: PlusIcon,
  refresh: ArrowPathIcon,
  list: ListBulletIcon,
  grid: Squares2X2Icon,
  back: ChevronLeftIcon,
  menu: Bars3Icon,
  text: DocumentTextIcon,
  link: LinkIcon,
  media: PhotoIcon,
  edit: PencilSquareIcon,
  more: EllipsisHorizontalIcon,
} as const;

/** Decorative chrome only; the control owns its accessible name. */
export function Icon({ name }: { name: keyof typeof icons }) {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" width="18" height="18" strokeWidth="1.7" />;
}
