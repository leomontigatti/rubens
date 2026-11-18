import { useEffect, useRef } from "react";

/** Whether the component is still mounted, for work that ends after it may have gone. */
export function useMountedRef() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
