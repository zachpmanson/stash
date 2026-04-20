declare module 'react-native-share-menu' {
  export interface SharedItem {
    mimeType: string;
    data: string;
    extraData?: Record<string, unknown>;
  }

  type ShareCallback = (item: SharedItem | null) => void;

  interface EventSubscription {
    remove(): void;
  }

  const ShareMenu: {
    getInitialShare(callback: ShareCallback): void;
    addNewShareListener(callback: ShareCallback): EventSubscription;
    dismissExtension(message?: string): void;
  };

  export default ShareMenu;
}
