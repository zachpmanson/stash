export type RootStackParamList = {
  Home: undefined;
  Folder: { folderId: string; folderName: string };
  ItemDetail: { itemId: string };
  Archive: undefined;
  MoveItem: { itemId: string };
  EditFolder: { folderId: string; folderName: string };
};
