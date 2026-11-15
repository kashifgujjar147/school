import { useGet } from '../../hooks/useApi';
import { useAuth } from '../../store/auth';

/** The attendance working days from school settings: a sensible starting point for a new bell schedule. */
export function useSettingsWorkingDays(): number[] | undefined {
  const can = useAuth((s) => s.can);
  const q = useGet<{ policy?: { workingDays?: number[] } }>(can('settings.view') ? '/api/settings' : null);
  return q.data?.data.policy?.workingDays;
}
