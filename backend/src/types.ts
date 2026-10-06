export type StaffUser = {
  id: string;
  org_id: string;
  name: string;
  email: string;
  status: string;
  role_id: string;
  role_name: string;
  is_admin: boolean;
  permissions: Record<string, string[]>;
  key_id?: string;
};
