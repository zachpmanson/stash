import { useEffect, useState } from "react";
import { fetchLinkPreview } from "src/utils/linkPreview";
import { LinkPreview } from "src/types";

export default function useLinkPreview(url: string | undefined) {
  const [linkMetadata, setLinkMetadata] = useState<LinkPreview>();
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    if (url) {
      setIsLoading(true);
      fetchLinkPreview(url)
        .then((metadata) => {
          setLinkMetadata(metadata);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [url]);

  return { linkMetadata, isLoading };
}
