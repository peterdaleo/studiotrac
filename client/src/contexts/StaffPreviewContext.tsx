import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface StaffPreviewContextType {
  isStaffPreview: boolean;
  toggleStaffPreview: () => void;
}

const StaffPreviewContext = createContext<StaffPreviewContextType>({
  isStaffPreview: false,
  toggleStaffPreview: () => {},
});

export function StaffPreviewProvider({ children }: { children: ReactNode }) {
  const [isStaffPreview, setIsStaffPreview] = useState(false);

  const toggleStaffPreview = useCallback(() => {
    setIsStaffPreview((prev) => !prev);
  }, []);

  return (
    <StaffPreviewContext.Provider value={{ isStaffPreview, toggleStaffPreview }}>
      {children}
    </StaffPreviewContext.Provider>
  );
}

export function useStaffPreview() {
  return useContext(StaffPreviewContext);
}

/**
 * Helper hook: returns the effective admin status.
 * If the real user is admin but staff preview is on, returns false.
 */
export function useEffectiveAdmin(realRole?: string) {
  const { isStaffPreview } = useStaffPreview();
  const reallyAdmin = realRole === "admin";
  return reallyAdmin && !isStaffPreview;
}
