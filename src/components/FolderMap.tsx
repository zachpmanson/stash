import {
  Map,
  Camera,
  Marker,
} from "@maplibre/maplibre-react-native";
import React, { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
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
        {located.map((item) => {
          const thumb = item.type === "image" ? item.uri : item.thumbnail_path;
          return (
            <Marker
              key={item.id}
              lngLat={[item.lng!, item.lat!]}
              anchor="bottom"
              onPress={() => router.push({ pathname: "/item/[id]", params: { id: item.id } })}
            >
              <View style={styles.marker}>
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.markerThumb} resizeMode="cover" />
                ) : (
                  <View style={styles.markerFallback}>
                    <Text style={styles.markerFallbackIcon}>📍</Text>
                  </View>
                )}
                <View style={styles.markerTail} />
              </View>
            </Marker>
          );
        })}
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
  marker: {
    alignItems: "center",
  },
  markerThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: Colors.surface,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  markerFallback: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  markerFallbackIcon: { fontSize: 20 },
  markerTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#ffffff",
    marginTop: -1,
  },
});
