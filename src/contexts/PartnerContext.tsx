import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { partnersApi, type PartnerRecord } from '../services/api';

interface PartnerContextType {
  partners: PartnerRecord[];
  activePartners: PartnerRecord[];
  solePartner: PartnerRecord | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const PartnerContext = createContext<PartnerContextType>({
  partners: [],
  activePartners: [],
  solePartner: null,
  loading: true,
  reload: async () => {},
});

export function PartnerProvider({ children }: { children: ReactNode }) {
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await partnersApi.getAll();
      setPartners(data);
    } catch {
      // Silently ignore — may fail if DB migration not yet applied
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const activePartners = partners.filter(p => p.is_active);
  const solePartner = activePartners.length === 1 ? activePartners[0] : null;

  return (
    <PartnerContext.Provider value={{ partners, activePartners, solePartner, loading, reload }}>
      {children}
    </PartnerContext.Provider>
  );
}

export function usePartners() {
  return useContext(PartnerContext);
}
