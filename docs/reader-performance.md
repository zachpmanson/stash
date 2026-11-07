# Large-article reader performance

Tracking: [zpm/stash#84](https://github.com/zachpmanson/stash/issues/84).

## Implementation

- Scroll offsets are refs, not per-frame React state. Sentence generation is demand-driven in the reader; listening keeps its original default.
- Formatted, non-recipe URL articles use one native **FlashList v2** with the existing header/actions, not a list nested inside a ScrollView.
- A conservative `linkedom` pass splits sibling blocks, retaining layout ancestors and inline/link/image relationships. Lists, quotes, tables, figures and unknown semantic subtrees stay whole. The reproducing article becomes **437 rows**, retaining **116 images and 182 links** in order.
- Rows share HTML render-engine/config providers and memoized sources. A 500 dp render-ahead distance and `maxItemsInRecyclePool={0}` bound retained native resources; distant cells unmount rather than accumulating in a recycling pool. Images are not eagerly prefetched for the entire document.
- Plain text, raw HTML, sentence and recipe modes retain their separate nonvirtual paths. Those modes can still take time to mount a very large document.
- An idempotent Expo plugin generates the existing native text-selection module, rather than depending on manually retained Android files.

FlashList is pinned to **2.3.3** and requires the New Architecture already used by this RN 0.83/Expo 55 app. It adds no extra direct runtime dependencies. Its installed source/types are the API authority: `getLayout(index)` has measured-height state and data-relative coordinates; `getFirstItemOffset()` supplies the header/padding offset; absolute `scrollToOffset` uses `skipFirstItemOffset`.

### Why not a deep FlatList initial index?

An initial FlatList prototype performed well but failed the far-end native bookmark gate. RN's `initialScrollIndex` requires known item geometry through `getItemLayout`. Seeding a deep index without that produces incompatible prefix estimates and measured positions, so windowing can evict the desired row. Simple mocked list slicing did not model that defect. The prototype was **not merged**. FlashList supplies supported dynamic-height acquisition instead of fabricated geometry, repeated offset jumps or custom backward pagination.

## Reading bookmarks

New reading bookmarks are independent of `listened_percent`. A device-local `reader_bookmarks` table stores versioned, validated records using existing DB ownership/replacement/recovery-write guards. The table is included in DB backups/restores; older local and seeded backups without it still restore. It is **not replicated across devices** and requires no server/schema rollout.

Formatted bookmarks identify the article revision and block plus a normalized within-block offset. Capture uses the engine's actual first visible row, measured height and absolute scroll/header offsets. Restore waits for engine load and the supported `scrollToIndex` Promise before aligning measured fractional geometry. Late image/header layouts retain an acquired position. Invalid/changed revisions fail with a message instead of jumping elsewhere.

Acquisition has a four-second failure boundary; obsolete/disposed operations cannot apply application callbacks. A gesture or reader/document/width/font-scale change cancels application alignment. FlashList exposes no cancellation token for an already-running engine acquisition, so the adapter does not pretend to abort it or call private internals. This is a viewport bookmark, not an exact selected-text annotation; native selection cannot survive eviction of its selected row.

Nonformatted modes retain local mode/scroll-fraction bookmarks. Existing listening percentages stay untouched and provide only **approximate legacy navigation**, never an exact row address.

## Validation

```sh
nix develop --command node node_modules/typescript/bin/tsc --noEmit
nix develop --command node --test scripts/test-*.cjs scripts/test-*.mjs
```

Frozen installation, TypeScript and **275 root tests** pass. Tests execute actual screen/hooks/sentence logic with mocked native/rendering/extraction boundaries plus real SQLite DB/restore harnesses. Coverage includes no scroll-driven screen commits, stable rows/config, HTML fidelity, modes/recipes/refresh/archive/listening, stale async results, measured navigation/header coordinates, Promise/load/failure/cancellation handling, independent bookmark validation/recovery guards, old local/seeded backups, untouched listening/sync state and deterministic selection-plugin generation. Native gates are required in addition to mocks.

### Physical-device acceptance

On the USB debug Pixel 8, with the final supported engine:

- Native long-press selection and saving/reopening a reading bookmark passed. The same paragraph restored at **exactly the same native bounds (0 px vertical difference)**.
- The real saved record used block 74 and a fractional offset while `listened_percent` remained **0**.
- A fresh-list bookmark at **row 351 of 437**, fraction 0.1, restored the correct paragraph and retained it after delayed layout settling, with **172 native views**.
- Backscrolling through the preceding document reached the original header after 45 gestures; returning to the deep bookmark passed. User backscroll was not pulled back by late application alignment; native views stayed at 172.
- Formatted images/text and plain/sentence/raw transitions passed. The sentence-mode assertion waits for the existing heavy nonvirtual mount to settle, rather than treating an early header-only UI snapshot as final content.

## Profile protocol and results

- Physical USB debug **Pixel 8**, Android 15, 1080×2400, 60 Hz; not the owner's wireless Pixel 8 Pro.
- Baseline source: `4354518`; quick-fix stage: `017c423`; supported engine source: `f6b8fea`. The final debug source map matches all **92 bundled application source files**.
- Self-contained arm64 debug builds through the capped devshell build. Baseline/quick-fix APKs differ only in their decompressed JS bundle. The tracked selection plugin emits byte-identical Kotlin to the original working module; final builds retain the same native features/dependency versions, with the added JS list engine.
- Identical offline Readability HTML from [Notes on San Marino](https://mattlakeman.org/2026/11/05/notes-on-san-marino/): about 19,762 words and 116 images. Existing debug data is privately backed up before adding a separate profiling-only item; no app-data clearing.
- Warm article/images first. Each of three trials force-stops/reopens the same deep link, waits 15 seconds, verifies the opening paragraph with UI Automator and resets `dumpsys gfxinfo`.
- Perform 20 identical 500 ms swipes (12 down, 8 up) at the same coordinates. Capture frame counters/percentiles, process CPU ticks, memory before/after, screenshots and a 32-second app-scoped Perfetto trace.
- CPU samples include the fixed tracing preamble and gesture interval. CPU seconds sum across app threads and can exceed wall time. Memory is sampled PSS, not an asserted peak. Local reading bookmarks are cleared only for the profiling fixture before comparison so its header matches the baseline.

| Median metric | Baseline | Quick fixes only | Final FlashList reader |
| --- | --- | --- | --- |
| Janky frames | 50.67% | 52.61% | **0.44%** |
| Frame p95 | 85 ms | 81 ms | **13 ms** |
| App CPU per sample | 25.59 s | 17.19 s | **11.31 s** |
| PSS after scrolling | 1551 MiB | 1531 MiB | **325 MiB** |
| Mounted native views after scrolling | 1306 | 1306 | **137–144** |

Final individual trials: jank **0.87% / 0.44% / 0.29%**, p95 **13 / 14 / 13 ms**, CPU **11.42 / 11.31 / 10.69 s**, sampled post-scroll PSS **325 / 326 / 325 MiB**. All three are the supported FlashList engine, not the rejected prototype.

Quick fixes alone cut CPU but did not demonstrate jank/memory improvement. Bounding the mounted HTML/image resources is the main improvement. Opening traces illustrate reduced mount stalls, but Android `am start -W` reports activity launch, **not article-ready latency**.

### Limitations and artifacts

Sequential debug trials are not release-device guarantees. Cache/network state, JIT and thermals remain confounders. Do not compare desktop extraction timing to native rendering or interpret gfxinfo alone as JS responsiveness. Some earlier Perfetto traces report dropped negative timestamps; scheduler totals support, rather than replace, the primary `/proc` CPU comparison. Large indivisible lists/tables/quotes can still be expensive, and native caches need not release every image immediately after row eviction.

Raw counters, traces, screenshots, scripted acceptance and APK/source provenance remain local at `/tmp/wolf-stash-profile/`; private debug DB backups are not uploaded. Build the delivery APK from merged `master`, arm64-only, using the existing template signing key; record its commit/hash and delivery receipt on the tracking issue. Production-phone installation is not implied by sending the APK.
