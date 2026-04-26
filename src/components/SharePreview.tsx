import { ActivityIndicator, ScrollView, StyleSheet, View, Text } from "react-native";
import { Fragment, useEffect, useState } from "react";
import { ResolvedSharePayload } from "expo-sharing";
import { Image } from "expo-image";
import { Colors, Radius, Spacing, Typography } from "src/theme";
import useLinkPreview from "src/hooks/useLinkPreview";

export default function SharePreview({ payloads }: { payloads: ResolvedSharePayload[] }) {
  return (
    <View style={[styles.container]}>
      {payloads.length > 1 ? (
        <ScrollView horizontal contentContainerStyle={styles.previewContent}>
          {payloads.map((payload, index) => (
            <Fragment key={index}>
              <SingleItem payload={payload} multiple={payloads.length > 1} />
            </Fragment>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.previewContent}>
          {payloads.map((payload, index) => (
            <Fragment key={index}>
              <SingleItem payload={payload} multiple={payloads.length > 1} />
            </Fragment>
          ))}
        </View>
      )}
    </View>
  );
}

function SingleItem({ payload, multiple }: { payload: ResolvedSharePayload; multiple: boolean }) {
  const { linkMetadata, isLoading } = useLinkPreview(payload.shareType === "url" ? payload.value : undefined);

  return (
    <>
      {payload.shareType === "image" ? (
        <Image
          source={{ uri: payload.contentUri ?? undefined }}
          style={[styles.imagePreview, multiple && styles.smallImage]}
        />
      ) : payload.shareType === "text" ? (
        <Text style={[styles.text]}>{payload.value}</Text>
      ) : payload.shareType === "url" ? (
        <View style={[styles.itemContainer]}>
          {isLoading && <ActivityIndicator color={Colors.white} />}
          {/* {linkMetadata && linkMetadata.image && <Image source={{ uri: linkMetadata.image }} style={styles.ogImage} />} */}
          {linkMetadata && linkMetadata.title && <Text style={[styles.text, styles.title]}>{linkMetadata.title}</Text>}
          {linkMetadata && linkMetadata.description && (
            <Text style={[styles.text, styles.description]}>{linkMetadata.description}</Text>
          )}
          <Text style={[styles.text, styles.url]} numberOfLines={3}>
            {payload.value}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
  itemContainer: {
    gap: 2,
  },
  imagePreview: {
    width: "100%",
    height: 140,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
    objectFit: "fill",
  },
  previewContent: {
    gap: Spacing.sm,
  },
  smallImage: {
    width: 140,
    height: 140,
  },
  ogImage: {
    width: "100%",
    height: 220,
    resizeMode: "cover",
    backgroundColor: Colors.surface2,
  },
  text: {
    color: "white",
    width: "100%",
  },
  title: {
    ...Typography.subheading,
    marginBottom: Spacing.sm,
    lineHeight: 26,
  },
  url: {
    color: Colors.accent,
    fontSize: 14,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  description: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
});
