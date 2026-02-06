import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * A simple hook to invalidate React Query keys.
 */
export const useInvalidateKey = () => {
  const queryClient = useQueryClient();

  const invalidate = useCallback((queryKey: string[]) => {
    // queryKey should be an array, e.g., ['users', id]
    return queryClient.invalidateQueries({ queryKey });
  }, [queryClient]);

  return invalidate;
};