import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getPaged, getWithMeta } from '../services/api';

/** GET with offline cache awareness: `fromCache` tells the page it is showing saved data. */
export function useGet<T>(url: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: [url],
    queryFn: () => getWithMeta<T>(url!),
    enabled: Boolean(url),
    refetchInterval: opts.refetchInterval,
    select: (r) => ({ data: r.data, fromCache: r.fromCache, meta: r.meta })
  });
}

export function usePaged<T>(url: string | null) {
  return useQuery({ queryKey: [url], queryFn: () => getPaged<T>(url!), enabled: Boolean(url), placeholderData: (prev) => prev });
}

/** Mutation that invalidates the given key prefixes on success. */
export function useAction<TArgs, TRes>(fn: (a: TArgs) => Promise<TRes>, invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const prefix of invalidate) qc.invalidateQueries({ predicate: (q) => String((q.queryKey as QueryKey)[0] ?? '').startsWith(prefix) });
    }
  });
}
