import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { View, type NativeScrollEvent, type NativeSyntheticEvent, type RefreshControlProps } from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { RenderHTMLSource, TRenderEngineProvider, RenderHTMLConfigProvider } from "react-native-render-html";
import type { ReaderBlock, ReaderDocument } from "../utils/readerChunks";
import type { ReaderBookmark } from "../utils/readerBookmark";
import { ReaderNavigation } from "../utils/readerNavigation";
import { Spacing } from "../theme";

const SYSTEM_FONTS = ["serif", "mono"];
const TEXT_PROPS = { selectable: true };
const Row = memo(function Row({ block, width }: { block: ReaderBlock; width: number }) {
  const source = useMemo(() => ({ html: block.html }), [block]);
  return <RenderHTMLSource source={source} contentWidth={width} />;
});

export interface VirtualArticleHandle {
  capture(): ReaderBookmark | null;
  restore(bookmark: ReaderBookmark): boolean;
  scrollToFraction(fraction: number): void;
}

export default memo(forwardRef<VirtualArticleHandle, {
  document: ReaderDocument;
  width: number;
  header: React.ReactElement;
  refreshControl: React.ReactElement<RefreshControlProps>;
  baseStyle: React.ComponentProps<typeof TRenderEngineProvider>["baseStyle"];
  tagsStyles: React.ComponentProps<typeof TRenderEngineProvider>["tagsStyles"];
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onRestoreFailed: () => void;
}>(function VirtualArticle({ document, width, header, refreshControl, baseStyle, tagsStyles, onScroll, onRestoreFailed }, ref) {
  const list = useRef<FlashListRef<ReaderBlock>>(null);
  const height = useRef(0);
  const navigation = useMemo(() => new ReaderNavigation(document, () => list.current, onRestoreFailed), [document, onRestoreFailed]);
  useEffect(() => () => navigation.dispose(), [navigation]);
  useImperativeHandle(ref, () => ({
    capture: () => navigation.capture(),
    restore: bookmark => navigation.restore(bookmark),
    scrollToFraction: fraction => {
      navigation.cancel();
      list.current?.scrollToOffset({ offset: height.current * fraction, animated: true, skipFirstItemOffset: true });
    },
  }), [navigation]);
  const renderItem = useCallback(({ item }: { item: ReaderBlock }) => (
    <View style={{ paddingHorizontal: Spacing.md }}><Row block={item} width={width} /></View>
  ), [width]);
  return (
    <TRenderEngineProvider baseStyle={baseStyle} tagsStyles={tagsStyles} systemFonts={SYSTEM_FONTS}>
      <RenderHTMLConfigProvider defaultTextProps={TEXT_PROPS}>
        <FlashList
          ref={list}
          data={document.blocks}
          keyExtractor={block => block.key}
          renderItem={renderItem}
          ListHeaderComponent={header}
          maxItemsInRecyclePool={0}
          drawDistance={500}
          maintainVisibleContentPosition={{ disabled: true }}
          onLoad={() => navigation.onLoad()}
          onCommitLayoutEffect={() => navigation.align()}
          contentContainerStyle={{ paddingBottom: Spacing.xl }}
          refreshControl={refreshControl}
          onScroll={event => {
            if (navigation.active) onScroll(event);
          }}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => navigation.cancel()}
          onContentSizeChange={(_w, h) => {
            if (!navigation.active) return;
            height.current = h;
            // Follow late image/header layouts after engine acquisition.
            navigation.align();
          }}
        />
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
}));
