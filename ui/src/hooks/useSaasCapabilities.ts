import { useQuery } from "@tanstack/react-query";
import { saasApi } from "@/api/saas";
export function useSaasCapabilities() {
  return useQuery({
    queryKey: ["saas-capabilities"],
    queryFn: saasApi.capabilities,
    retry: false,
    staleTime: 30000,
  });
}
