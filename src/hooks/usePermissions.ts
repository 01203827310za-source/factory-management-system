import { useAuth } from '../contexts/AuthContext';

export function useCrudPermissions(module: string) {
  const { can } = useAuth();
  return {
    canView: can(`${module}.view`),
    canCreate: can(`${module}.create`),
    canEdit: can(`${module}.edit`),
    canDelete: can(`${module}.delete`),
  };
}
