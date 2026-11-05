import React from "react";
import {
  IconArchive,
  IconChevronLeft,
  IconDots,
  IconEdit,
  IconFileText,
  IconFolder,
  IconLayoutGrid,
  IconLink,
  IconList,
  IconMenu2,
  IconPhoto,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";

const icons = {
  folder: IconFolder,
  all: IconLayoutGrid,
  archive: IconArchive,
  plus: IconPlus,
  refresh: IconRefresh,
  list: IconList,
  grid: IconLayoutGrid,
  back: IconChevronLeft,
  menu: IconMenu2,
  text: IconFileText,
  link: IconLink,
  media: IconPhoto,
  edit: IconEdit,
  more: IconDots,
} as const;

/** Decorative chrome only; the control owns its accessible name. */
export function Icon({ name }: { name: keyof typeof icons }) {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" focusable="false" size={18} stroke={1.7} />;
}
