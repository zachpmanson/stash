import React, { createContext, useContext, useState, useCallback } from 'react';
import { ShareData } from '../types';

interface ShareContextValue {
  pendingShare: ShareData | null;
  setPendingShare: (data: ShareData | null) => void;
  clearShare: () => void;
}

const ShareContext = createContext<ShareContextValue>({
  pendingShare: null,
  setPendingShare: () => {},
  clearShare: () => {},
});

export function ShareProvider({ children }: { children: React.ReactNode }) {
  const [pendingShare, setPendingShareState] = useState<ShareData | null>(null);

  const setPendingShare = useCallback((data: ShareData | null) => {
    setPendingShareState(data);
  }, []);

  const clearShare = useCallback(() => {
    setPendingShareState(null);
  }, []);

  return (
    <ShareContext.Provider value={{ pendingShare, setPendingShare, clearShare }}>
      {children}
    </ShareContext.Provider>
  );
}

export function useShare() {
  return useContext(ShareContext);
}
