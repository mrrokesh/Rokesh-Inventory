export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' | 'import';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  org_id: string;
  org_name?: string;
  currency?: string;
  is_admin?: boolean;
  role_name?: string;
  permissions?: Record<string, string[]>;
  integrations?: string[];
  org_state?: string;
  gst_enabled?: boolean;
};

export type PageResult<T> = {
  data: T[];
  total: number;
  page?: number;
  per_page?: number;
};

export type DocCfg = {
  key: string;
  api: string;
  path: string;
  title: string;
  one: string;
  perm: string;
  entity: string;
  contactType: 'customer' | 'vendor';
  priceKind: 'sales' | 'purchase';
  numberLabel: string;
  dateLabel: string;
  printTitle: string;
  warehouseLabel?: string;
  addresses?: boolean;
  hasBalance?: boolean;
  hasCredit?: boolean;
  linkField?: string;
  lineLink?: string;
  accountColumn?: boolean;
  manualNumber?: boolean;
  header: Array<{
    key: string;
    label: string;
    type: string;
    options?: Array<[string, string]>;
    list?: string[];
  }>;
  statuses: Array<[string, string]>;
  postLabel: string;
  postAction: string;
};
