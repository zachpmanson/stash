import {
  Map,
  Camera,
  Marker,
  Callout,
} from "@maplibre/maplibre-react-native";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StashItem } from "../types";
import { Colors, Spacing, Typography } from "../theme";

// Free, keyless MapLibre vector tile source (OpenFreeMap).
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

type Props = {
  items: StashItem[];
  folderName: string;
};

export default function FolderMap({ items, folderName }: Props) {
  const router = useRouter();

  const located = useMemo(() => items.filter((i) => i.lat != null && i.lng != null), [items]);

  if (located.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🗺️</Text>
        <Text style={styles.emptyTitle}>No locations yet</Text>
        <Text style={styles.emptyBody}>
          Stash photos with the "Store location" option to see them on a map.
        </Text>
      </View>
    );
  }

  const first = located[0];

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={STYLE_URL}>
        <Camera center={[first.lng!, first.lat!]} zoom={12} />
        {located.map((item) => (
          <Marker
            key={item.id}
            lngLat={[item.lng!, item.lat!]}
            anchor="bottom"
            onPress={() => router.push({ pathname: "/item/[id]", params: { id: item.id } })}
          >
            <Callout title={item.title ?? "Stashed item"} />
          </Marker>
        ))}
      </Map>
      <View style={styles.legend}>
        <Text style={styles.legendText}>
          {located.length} {located.length === 1 ? "location" : "locations"} · {folderName}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
  emptyTitle: { ...Typography.subheading, marginBottom: Spacing.sm },
  emptyBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  legend: {
    position: "absolute",
    top: Spacing.md,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  legendText: { ...Typography.caption, color: "#ffffff" },
});
