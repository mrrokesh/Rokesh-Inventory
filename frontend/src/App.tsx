import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { setCurrency } from './lib/format';
import Layout from './components/Layout';
import { EmptyState, Spinner } from './components/ui';
import { DOCS } from './pages/docs/config';
import type { DocCfg } from './types';

const Login = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login })));
const Signup = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Signup })));
const AcceptInvite = lazy(() => import('./pages/Auth').then((m) => ({ default: m.AcceptInvite })));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ItemsList = lazy(() => import('./pages/items/ItemsList'));
const ItemForm = lazy(() => import('./pages/items/ItemForm'));
const ItemDetail = lazy(() => import('./pages/items/ItemDetail'));
const ItemGroupsList = lazy(() => import('./pages/items/ItemGroups').then((m) => ({ default: m.ItemGroupsList })));
const ItemGroupForm = lazy(() => import('./pages/items/ItemGroups').then((m) => ({ default: m.ItemGroupForm })));
const ItemGroupDetail = lazy(() => import('./pages/items/ItemGroups').then((m) => ({ default: m.ItemGroupDetail })));
const PriceLists = lazy(() => import('./pages/items/ItemGroups').then((m) => ({ default: m.PriceLists })));
const ContactsList = lazy(() => import('./pages/Contacts').then((m) => ({ default: m.ContactsList })));
const ContactForm = lazy(() => import('./pages/Contacts').then((m) => ({ default: m.ContactForm })));
const ContactDetail = lazy(() => import('./pages/Contacts').then((m) => ({ default: m.ContactDetail })));
const DocList = lazy(() => import('./pages/docs/DocList'));
const DocForm = lazy(() => import('./pages/docs/DocForm'));
const DocDetail = lazy(() => import('./pages/docs/DocDetail'));
const PackagesList = lazy(() => import('./pages/Fulfilment').then((m) => ({ default: m.PackagesList })));
const PackageDetail = lazy(() => import('./pages/Fulfilment').then((m) => ({ default: m.PackageDetail })));
const ShipmentsList = lazy(() => import('./pages/Fulfilment').then((m) => ({ default: m.ShipmentsList })));
const ShipmentDetail = lazy(() => import('./pages/Fulfilment').then((m) => ({ default: m.ShipmentDetail })));
const SalesReturnsList = lazy(() => import('./pages/Fulfilment').then((m) => ({ default: m.SalesReturnsList })));
const SalesReturnDetail = lazy(() => import('./pages/Fulfilment').then((m) => ({ default: m.SalesReturnDetail })));
const PurchaseReceivesList = lazy(() => import('./pages/Fulfilment').then((m) => ({ default: m.PurchaseReceivesList })));
const PurchaseReceiveDetail = lazy(() => import('./pages/Fulfilment').then((m) => ({ default: m.PurchaseReceiveDetail })));
const LandedCostsList = lazy(() => import('./pages/LandedCosts').then((m) => ({ default: m.LandedCostsList })));
const LandedCostForm = lazy(() => import('./pages/LandedCosts').then((m) => ({ default: m.LandedCostForm })));
const LandedCostDetail = lazy(() => import('./pages/LandedCosts').then((m) => ({ default: m.LandedCostDetail })));
const PaymentsList = lazy(() => import('./pages/Payments').then((m) => ({ default: m.PaymentsList })));
const PaymentForm = lazy(() => import('./pages/Payments').then((m) => ({ default: m.PaymentForm })));
const PaymentDetail = lazy(() => import('./pages/Payments').then((m) => ({ default: m.PaymentDetail })));
const AdjustmentsList = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.AdjustmentsList })));
const AdjustmentForm = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.AdjustmentForm })));
const AdjustmentDetail = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.AdjustmentDetail })));
const TransfersList = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.TransfersList })));
const TransferForm = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.TransferForm })));
const TransferDetail = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.TransferDetail })));
const AssembliesList = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.AssembliesList })));
const AssemblyForm = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.AssemblyForm })));
const AssemblyDetail = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.AssemblyDetail })));
const StockCountsList = lazy(() => import('./pages/WarehouseOps').then((m) => ({ default: m.StockCountsList })));
const StockCountForm = lazy(() => import('./pages/WarehouseOps').then((m) => ({ default: m.StockCountForm })));
const StockCountDetail = lazy(() => import('./pages/WarehouseOps').then((m) => ({ default: m.StockCountDetail })));
const PicklistsList = lazy(() => import('./pages/WarehouseOps').then((m) => ({ default: m.PicklistsList })));
const PicklistForm = lazy(() => import('./pages/WarehouseOps').then((m) => ({ default: m.PicklistForm })));
const PicklistDetail = lazy(() => import('./pages/WarehouseOps').then((m) => ({ default: m.PicklistDetail })));
const TasksList = lazy(() => import('./pages/WarehouseOps').then((m) => ({ default: m.TasksList })));
const TaskDetail = lazy(() => import('./pages/WarehouseOps').then((m) => ({ default: m.TaskDetail })));
const ReportsIndex = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsIndex })));
const ReportView = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportView })));
const ReportBuilder = lazy(() => import('./pages/ReportBuilder'));
const ModuleList = lazy(() => import('./pages/CustomModules').then((m) => ({ default: m.ModuleList })));
const ModuleRecordForm = lazy(() => import('./pages/CustomModules').then((m) => ({ default: m.ModuleRecordForm })));
const ModuleRecordDetail = lazy(() => import('./pages/CustomModules').then((m) => ({ default: m.ModuleRecordDetail })));
const WebTabPage = lazy(() => import('./pages/CustomModules').then((m) => ({ default: m.WebTabPage })));
const PublicForm = lazy(() => import('./pages/PublicForm'));
const Documents = lazy(() => import('./pages/Documents'));
const Import = lazy(() => import('./pages/Import'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Profile })));
const Help = lazy(() => import('./pages/help/Help'));
const Portal = lazy(() => import('./pages/portal/Portal'));
const Platform = lazy(() => import('./pages/platform/Platform'));
const PublicSite = lazy(() => import('./pages/PublicSite'));

function Guard({ perm, action = 'view', children }: { perm?: string; action?: string; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(perm, action)) {
    return <div className="page"><EmptyState title="No access" text="Your role does not have permission to open this page. Ask an administrator." /></div>;
  }
  return children;
}

function PageFallback() {
  return <div className="page"><Spinner /></div>;
}

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  useEffect(() => { if (user) setCurrency(user.currency); }, [user]);
  useEffect(() => { document.querySelector('.content')?.scrollTo(0, 0); }, [location.pathname]);

  if (location.pathname.startsWith('/f/')) {
    return (
      <Suspense fallback={<Spinner />}>
        <Routes><Route path="/f/:token" element={<PublicForm />} /></Routes>
      </Suspense>
    );
  }
  if (location.pathname.startsWith('/portal/')) {
    return (
      <Suspense fallback={<Spinner />}>
        <Routes><Route path="/portal/:slug/*" element={<Portal />} /></Routes>
      </Suspense>
    );
  }
  if (location.pathname.startsWith('/platform')) {
    return (
      <Suspense fallback={<Spinner />}>
        <Routes><Route path="/platform/*" element={<Platform />} /></Routes>
      </Suspense>
    );
  }
  if (['/pricing', '/support', '/terms', '/privacy'].includes(location.pathname)) {
    return (
      <Suspense fallback={<Spinner />}>
        <PublicSite />
      </Suspense>
    );
  }
  if (loading) return <Spinner />;
  if (!user) {
    return (
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/signup" element={<Signup />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="*" element={<Login />} />
        </Routes>
      </Suspense>
    );
  }

  const docRoutes = Object.values(DOCS as unknown as Record<string, DocCfg>).flatMap((cfg) => [
    <Route key={`${cfg.key}-l`} path={cfg.path} element={<Guard perm={cfg.perm}><DocList cfg={cfg} /></Guard>} />,
    <Route key={`${cfg.key}-n`} path={`${cfg.path}/new`} element={<Guard perm={cfg.perm} action="create"><DocForm key={`${cfg.key}-new${location.search}`} cfg={cfg} /></Guard>} />,
    <Route key={`${cfg.key}-d`} path={`${cfg.path}/:id`} element={<Guard perm={cfg.perm}><DocDetail key={cfg.key} cfg={cfg} /></Guard>} />,
    <Route key={`${cfg.key}-e`} path={`${cfg.path}/:id/edit`} element={<Guard perm={cfg.perm} action="edit"><DocForm key={`${cfg.key}-edit`} cfg={cfg} /></Guard>} />,
  ]);

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/signup" element={<Navigate to="/" replace />} />

          <Route path="/items" element={<Guard perm="items"><ItemsList /></Guard>} />
          <Route path="/items/new" element={<Guard perm="items" action="create"><ItemForm /></Guard>} />
          <Route path="/items/:id" element={<Guard perm="items"><ItemDetail /></Guard>} />
          <Route path="/items/:id/edit" element={<Guard perm="items" action="edit"><ItemForm /></Guard>} />
          <Route path="/composite-items" element={<Guard perm="items"><ItemsList composite /></Guard>} />
          <Route path="/composite-items/new" element={<Guard perm="items" action="create"><ItemForm composite /></Guard>} />
          <Route path="/item-groups" element={<Guard perm="items"><ItemGroupsList /></Guard>} />
          <Route path="/item-groups/new" element={<Guard perm="items" action="create"><ItemGroupForm /></Guard>} />
          <Route path="/item-groups/:id" element={<Guard perm="items"><ItemGroupDetail /></Guard>} />
          <Route path="/item-groups/:id/edit" element={<Guard perm="items" action="edit"><ItemGroupForm /></Guard>} />
          <Route path="/price-lists" element={<Guard perm="items"><PriceLists /></Guard>} />

          <Route path="/inventory/adjustments" element={<Guard perm="inventory"><AdjustmentsList /></Guard>} />
          <Route path="/inventory/adjustments/new" element={<Guard perm="inventory" action="create"><AdjustmentForm /></Guard>} />
          <Route path="/inventory/adjustments/:id" element={<Guard perm="inventory"><AdjustmentDetail /></Guard>} />
          <Route path="/inventory/adjustments/:id/edit" element={<Guard perm="inventory" action="edit"><AdjustmentForm /></Guard>} />
          <Route path="/inventory/transfers" element={<Guard perm="inventory"><TransfersList /></Guard>} />
          <Route path="/inventory/transfers/new" element={<Guard perm="inventory" action="create"><TransferForm /></Guard>} />
          <Route path="/inventory/transfers/:id" element={<Guard perm="inventory"><TransferDetail /></Guard>} />
          <Route path="/inventory/transfers/:id/edit" element={<Guard perm="inventory" action="edit"><TransferForm /></Guard>} />
          <Route path="/inventory/assemblies" element={<Guard perm="inventory"><AssembliesList /></Guard>} />
          <Route path="/inventory/assemblies/new" element={<Guard perm="inventory" action="create"><AssemblyForm /></Guard>} />
          <Route path="/inventory/assemblies/:id" element={<Guard perm="inventory"><AssemblyDetail /></Guard>} />
          <Route path="/inventory/stock-counts" element={<Guard perm="inventory"><StockCountsList /></Guard>} />
          <Route path="/inventory/stock-counts/new" element={<Guard perm="inventory" action="create"><StockCountForm /></Guard>} />
          <Route path="/inventory/stock-counts/:id" element={<Guard perm="inventory"><StockCountDetail /></Guard>} />
          <Route path="/inventory/picklists" element={<Guard perm="packages"><PicklistsList /></Guard>} />
          <Route path="/inventory/picklists/new" element={<Guard perm="packages" action="create"><PicklistForm /></Guard>} />
          <Route path="/inventory/picklists/:id" element={<Guard perm="packages"><PicklistDetail /></Guard>} />

          <Route path="/tasks" element={<TasksList />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />

          <Route path="/customers" element={<Guard perm="customers"><ContactsList key="c" type="customer" /></Guard>} />
          <Route path="/customers/new" element={<Guard perm="customers" action="create"><ContactForm key="cn" type="customer" /></Guard>} />
          <Route path="/customers/:id" element={<Guard perm="customers"><ContactDetail key="cd" type="customer" /></Guard>} />
          <Route path="/customers/:id/edit" element={<Guard perm="customers" action="edit"><ContactForm key="ce" type="customer" /></Guard>} />
          <Route path="/vendors" element={<Guard perm="vendors"><ContactsList key="v" type="vendor" /></Guard>} />
          <Route path="/vendors/new" element={<Guard perm="vendors" action="create"><ContactForm key="vn" type="vendor" /></Guard>} />
          <Route path="/vendors/:id" element={<Guard perm="vendors"><ContactDetail key="vd" type="vendor" /></Guard>} />
          <Route path="/vendors/:id/edit" element={<Guard perm="vendors" action="edit"><ContactForm key="ve" type="vendor" /></Guard>} />

          {docRoutes}

          <Route path="/packages" element={<Guard perm="packages"><PackagesList /></Guard>} />
          <Route path="/packages/:id" element={<Guard perm="packages"><PackageDetail /></Guard>} />
          <Route path="/shipments" element={<Guard perm="packages"><ShipmentsList /></Guard>} />
          <Route path="/shipments/:id" element={<Guard perm="packages"><ShipmentDetail /></Guard>} />
          <Route path="/sales-returns" element={<Guard perm="sales_returns"><SalesReturnsList /></Guard>} />
          <Route path="/sales-returns/:id" element={<Guard perm="sales_returns"><SalesReturnDetail /></Guard>} />
          <Route path="/purchase-receives" element={<Guard perm="purchase_receives"><PurchaseReceivesList /></Guard>} />
          <Route path="/purchase-receives/:id" element={<Guard perm="purchase_receives"><PurchaseReceiveDetail /></Guard>} />
          <Route path="/landed-costs" element={<Guard perm="bills"><LandedCostsList /></Guard>} />
          <Route path="/landed-costs/new" element={<Guard perm="bills" action="create"><LandedCostForm key={location.search} /></Guard>} />
          <Route path="/landed-costs/:id" element={<Guard perm="bills"><LandedCostDetail /></Guard>} />

          <Route path="/payments-received" element={<Guard perm="payments_received"><PaymentsList key="pr" kind="received" /></Guard>} />
          <Route path="/payments-received/new" element={<Guard perm="payments_received" action="create"><PaymentForm key={`prn${location.search}`} kind="received" /></Guard>} />
          <Route path="/payments-received/:id" element={<Guard perm="payments_received"><PaymentDetail key="prd" kind="received" /></Guard>} />
          <Route path="/payments-received/:id/edit" element={<Guard perm="payments_received" action="edit"><PaymentForm key="pre" kind="received" /></Guard>} />
          <Route path="/payments-made" element={<Guard perm="payments_made"><PaymentsList key="pm" kind="made" /></Guard>} />
          <Route path="/payments-made/new" element={<Guard perm="payments_made" action="create"><PaymentForm key={`pmn${location.search}`} kind="made" /></Guard>} />
          <Route path="/payments-made/:id" element={<Guard perm="payments_made"><PaymentDetail key="pmd" kind="made" /></Guard>} />
          <Route path="/payments-made/:id/edit" element={<Guard perm="payments_made" action="edit"><PaymentForm key="pme" kind="made" /></Guard>} />

          <Route path="/reports" element={<Guard perm="reports"><ReportsIndex /></Guard>} />
          <Route path="/m/:slug" element={<Guard perm="custom_modules"><ModuleList /></Guard>} />
          <Route path="/m/:slug/new" element={<Guard perm="custom_modules" action="create"><ModuleRecordForm key="new" /></Guard>} />
          <Route path="/m/:slug/:id/edit" element={<Guard perm="custom_modules" action="edit"><ModuleRecordForm /></Guard>} />
          <Route path="/m/:slug/:id" element={<Guard perm="custom_modules"><ModuleRecordDetail /></Guard>} />
          <Route path="/tabs/:id" element={<WebTabPage />} />
          <Route path="/reports/custom/new" element={<Guard perm="reports"><ReportBuilder key="new" /></Guard>} />
          <Route path="/reports/custom/:id/edit" element={<Guard perm="reports"><ReportBuilder /></Guard>} />
          <Route path="/reports/:key" element={<Guard perm="reports"><ReportView /></Guard>} />
          <Route path="/documents" element={<Guard perm="documents"><Documents /></Guard>} />
          <Route path="/import/:type" element={<Import />} />
          <Route path="/settings/*" element={<Guard perm="settings"><Settings /></Guard>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/help" element={<Help />} />
          <Route path="/help/:slug" element={<Help />} />
          <Route path="/invite/:token" element={<Navigate to="/" replace />} />
          <Route path="*" element={<div className="page"><EmptyState title="Page not found" text="The page you are looking for does not exist." /></div>} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
