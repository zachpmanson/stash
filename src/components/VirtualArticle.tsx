import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FlatList, View, type CellRendererProps, type NativeScrollEvent, type NativeSyntheticEvent, type RefreshControlProps } from "react-native";
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
  const list = useRef<FlatList<ReaderBlock>>(null);
  const height = useRef(0);
  const generation = useRef(0);
  const [renderWindow, setRenderWindow] = useState<{ generation: number; index?: number }>({ generation: 0 });
  const navigation = useMemo(() => new ReaderNavigation(document, () => list.current, index => {
    height.current = 0;
    setRenderWindow({ generation: ++generation.current, index });
  }, onRestoreFailed), [document, onRestoreFailed]);
  useEffect(() => () => navigation.cancel(), [navigation]);
  useImperativeHandle(ref, () => ({
    capture: () => navigation.capture(),
    restore: bookmark => navigation.restore(bookmark),
    scrollToFraction: fraction => { navigation.cancel(); list.current?.scrollToOffset({ offset: height.current * fraction, animated: true }); },
  }), [navigation]);
  const Cell = useMemo(() => function Cell(props: CellRendererProps<ReaderBlock>) {
    useEffect(() => () => {
      if (generation.current === renderWindow.generation) navigation.unmeasure(props.index);
    }, [props.index]);
    // RN's own cell forwards this event, although ViewProps omits its type.
    return <View {...{ onFocusCapture: props.onFocusCapture }} onLayout={event => {
      props.onLayout?.(event);
      if (generation.current !== renderWindow.generation) return;
      const { y, height } = event.nativeEvent.layout;
      navigation.measure(props.index, { y, height });
    }} style={props.style}>{props.children}</View>;
  }, [navigation, renderWindow.generation]);
  const renderItem = useCallback(({ item }: { item: ReaderBlock }) => (
    <View style={{ paddingHorizontal: Spacing.md }}><Row block={item} width={width} /></View>
  ), [width]);
  return (
    <TRenderEngineProvider baseStyle={baseStyle} tagsStyles={tagsStyles} systemFonts={SYSTEM_FONTS}>
      <RenderHTMLConfigProvider defaultTextProps={TEXT_PROPS}>
        <FlatList
          key={renderWindow.generation}
          ref={list}
          initialScrollIndex={renderWindow.index}
          data={document.blocks}
          keyExtractor={block => block.key}
          renderItem={renderItem}
          CellRendererComponent={Cell}
          ListHeaderComponent={header}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={5}
          removeClippedSubviews={false}
          contentContainerStyle={{ paddingBottom: Spacing.xl }}
          refreshControl={refreshControl}
          onScroll={event => {
            if (generation.current !== renderWindow.generation) return;
            navigation.scrollY = event.nativeEvent.contentOffset.y; onScroll(event);
          }}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => {
            if (generation.current === renderWindow.generation) navigation.cancel();
          }}
          onScrollToIndexFailed={info => {
            if (generation.current === renderWindow.generation) navigation.failed(info);
          }}
          onContentSizeChange={(_w, h) => {
            if (generation.current !== renderWindow.generation) return;
            height.current = h;
            // RN may perform its initial index jump here; reapply the measured
            // within-row offset afterwards, also following late image layouts.
            navigation.align();
          }}
        />
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
}));
