import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { label } from '../lib/format';
import { applyBrandColor, getTheme, setTheme } from '../lib/theme';
import { useLookups } from '../lib/lookups';
import { helpSlugFor } from '../pages/help/index';
import { APP_NAME, LOGO_SRC } from '../brand';
import Icon from './Icon';
import { ConfirmHost, Dropdown, useDebounced } from './ui';

export const NAV = [
  { key: 'home', label: 'Home', icon: 'home', to: '/' },
  {
    key: 'items', label: 'Items', icon: 'items', children: [
      { label: 'Items', to: '/items', perm: 'items' },
      { label: 'Item Groups', to: '/item-groups', perm: 'items' },
      { label: 'Composite Items', to: '/composite-items', perm: 'items' },
      { label: 'Price Lists', to: '/price-lists', perm: 'items' },
    ],
  },
  {
    key: 'inventory', label: 'Inventory', icon: 'inventory', children: [
      { label: 'Inventory Adjustments', to: '/inventory/adjustments', perm: 'inventory' },
      { label: 'Stock Counts', to: '/inventory/stock-counts', perm: 'inventory' },
      { label: 'Transfer Orders', to: '/inventory/transfers', perm: 'inventory' },
      { label: 'Assemblies', to: '/inventory/assemblies', perm: 'inventory' },
      { label: 'Picklists', to: '/inventory/picklists', perm: 'packages' },
      { label: 'Packages', to: '/packages', perm: 'packages' },
      { label: 'Shipments', to: '/shipments', perm: 'packages' },
    ],
  },
  {
    key: 'sales', label: 'Sales', icon: 'sales', children: [
      { label: 'Customers', to: '/customers', perm: 'customers' },
      { label: 'Estimates', to: '/estimates', perm: 'estimates' },
      { label: 'Sales Orders', to: '/sales-orders', perm: 'sales_orders' },
      { label: 'Delivery Challans', to: '/delivery-challans', perm: 'delivery_challans' },
      { label: 'Invoices', to: '/invoices', perm: 'invoices' },
      { label: 'Payments Received', to: '/payments-received', perm: 'payments_received' },
      { label: 'Sales Returns', to: '/sales-returns', perm: 'sales_returns' },
      { label: 'Credit Notes', to: '/credit-notes', perm: 'sales_returns' },
    ],
  },
  {
    key: 'purchases', label: 'Purchases', icon: 'purchases', children: [
      { label: 'Vendors', to: '/vendors', perm: 'vendors' },
      { label: 'Purchase Orders', to: '/purchase-orders', perm: 'purchase_orders' },
      { label: 'Purchase Receives', to: '/purchase-receives', perm: 'purchase_receives' },
      { label: 'Bills', to: '/bills', perm: 'bills' },
      { label: 'Payments Made', to: '/payments-made', perm: 'payments_made' },
      { label: 'Vendor Credits', to: '/vendor-credits', perm: 'vendor_credits' },
      { label: 'Landed Costs', to: '/landed-costs', perm: 'bills' },
    ],
  },
  { key: 'tasks', label: 'Tasks', icon: 'check', to: '/tasks' },
  { key: 'reports', label: 'Reports', icon: 'reports', to: '/reports', perm: 'reports' },
  { key: 'documents', label: 'Documents', icon: 'documents', to: '/documents', perm: 'documents' },
  { key: 'help', label: 'Help & Guides', icon: 'help', to: '/help' },
];

const QUICK_CREATE: any[] = [
  ['General', [['Item', '/items/new', 'items'], ['Item Group', '/item-groups/new', 'items'], ['Composite Item', '/composite-items/new', 'items'], ['Inventory Adjustment', '/inventory/adjustments/new', 'inventory'], ['Transfer Order', '/inventory/transfers/new', 'inventory']]],
  ['Sales', [['Customer', '/customers/new', 'customers'], ['Estimate', '/estimates/new', 'estimates'], ['Sales Order', '/sales-orders/new', 'sales_orders'], ['Delivery Challan', '/delivery-challans/new', 'delivery_challans'], ['Invoice', '/invoices/new', 'invoices'], ['Payment Received', '/payments-received/new', 'payments_received'], ['Credit Note', '/credit-notes/new', 'sales_returns']]],
  ['Purchases', [['Vendor', '/vendors/new', 'vendors'], ['Purchase Order', '/purchase-orders/new', 'purchase_orders'], ['Bill', '/bills/new', 'bills'], ['Payment Made', '/payments-made/new', 'payments_made'], ['Vendor Credit', '/vendor-credits/new', 'vendor_credits']]],
];

const SEARCH_LINKS = {
  item: (id) => `/items/${id}`, customer: (id) => `/customers/${id}`, vendor: (id) => `/vendors/${id}`,
  sales_order: (id) => `/sales-orders/${id}`, invoice: (id) => `/invoices/${id}`, purchase_order: (id) => `/purchase-orders/${id}`,
  bill: (id) => `/bills/${id}`, package: (id) => `/packages/${id}`, shipment: (id) => `/shipments/${id}`,
  credit_note: (id) => `/credit-notes/${id}`, vendor_credit: (id) => `/vendor-credits/${id}`,
  estimate: (id) => `/estimates/${id}`, delivery_challan: (id) => `/delivery-challans/${id}`, serial: (id) => `/items/${id}?tab=tracking`,
};

function Sidebar() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const { customModules, webTabs } = useLookups('customModules', 'webTabs');
  // Custom modules and web tabs the organization added appear in their own group.
  const extra = [
    ...(customModules?.modules || []).filter((m) => m.show_in_nav).map((m) => ({ label: m.name, to: `/m/${m.slug}`, perm: 'custom_modules' })),
    ...(webTabs || []).map((t) => ({ label: t.name, to: `/tabs/${t.id}` })),
  ];
  const nav = extra.length ? [...NAV.slice(0, NAV.findIndex((g) => g.key === 'tasks')), { key: 'more', label: 'More', icon: 'documents', children: extra }, ...NAV.slice(NAV.findIndex((g) => g.key === 'tasks'))] : NAV;
  const isActive = (to) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
  const initialOpen = () => Object.fromEntries(nav.filter((g) => g.children).map((g) => [g.key, g.children.some((c) => isActive(c.to))]));
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    setOpen((o) => ({ ...o, ...Object.fromEntries(nav.filter((g) => g.children && g.children.some((c) => isActive(c.to))).map((g) => [g.key, true])) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, extra.length]);

  return (
    <nav className="sidebar no-print" aria-label="Main">
      <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
        <img className="brand-mark" src={LOGO_SRC} alt="" />
        <span className="brand-name">{APP_NAME}</span>
      </Link>
      {nav.map((g: any) => {
        if (g.children) {
          const children = g.children.filter((c) => !c.perm || can(c.perm));
          if (!children.length) return null;
          const active = children.some((c) => isActive(c.to));
          return (
            <div className="nav-group" key={g.key}>
              <button type="button" className={`nav-head ${open[g.key] ? 'open' : ''} ${active ? 'active' : ''}`} onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
                <Icon name={g.icon} /><span>{g.label}</span><Icon name="chevron" size={14} className="chev" />
              </button>
              {open[g.key] && children.map((c) => (
                <NavLink key={c.to} to={c.to} className={() => `nav-link sub ${isActive(c.to) ? 'active' : ''}`}>{c.label}</NavLink>
              ))}
            </div>
          );
        }
        if (g.perm && !can(g.perm)) return null;
        return (
          <NavLink key={g.key} to={g.to} className={() => `nav-link ${isActive(g.to) ? 'active' : ''}`}>
            <Icon name={g.icon} /><span>{g.label}</span>
          </NavLink>
        );
      })}
      <div style={{ flex: 1 }} />
      {can('settings') && (
        <NavLink to="/settings" className={() => `nav-link ${pathname.startsWith('/settings') ? 'active' : ''}`} style={{ marginBottom: 12 }}>
          <Icon name="settings" /><span>Settings</span>
        </NavLink>
      )}
    </nav>
  );
}

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const debounced = useDebounced(term, 250);
  const ref = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (debounced.trim().length < 2) { setResults(null); return; }
    let alive = true;
    api.get('/dashboard/search', { q: debounced }).then((r) => alive && setResults(r)).catch(() => alive && setResults([]));
    return () => { alive = false; };
  }, [debounced]);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setResults(null); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  return (
    <div className="search" ref={ref}>
      <Icon name="search" size={14} className="" />
      <input placeholder="Search items, contacts, orders, invoices…" value={term} onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results?.[0]) { navigate(SEARCH_LINKS[results[0].type](results[0].id)); setResults(null); setTerm(''); } }} />
      {results && (
        <div className="search-results">
          {results.length === 0 && <div className="faint" style={{ padding: 12 }}>No results</div>}
          {results.map((r) => (
            <Link key={`${r.type}-${r.id}`} to={SEARCH_LINKS[r.type](r.id)} onClick={() => { setResults(null); setTerm(''); }}>
              <div className="row"><span>{r.title}</span><span className="spacer" /><span className="badge">{label(r.type)}</span></div>
              {r.subtitle && <div className="small faint">{r.subtitle}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [data, setData] = useState(null);
  const [openTasks, setOpenTasks] = useState(0);
  const load = () => {
    api.get('/dashboard', { period: 'this_month' }).then(setData).catch(() => {});
    api.get('/tasks', { status: 'open', assignee_id: 'me', per_page: 1 }).then((r) => setOpenTasks(r.total || 0)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const p = data?.pending || {};
  const lowStock = data?.products?.low_stock || 0;
  const overdue = Number(data?.money?.receivables_overdue || 0) > 0;
  const items = [
    lowStock > 0 && { text: `${lowStock} item(s) at or below reorder point`, to: '/items?stock=low' },
    p.to_be_packed > 0 && { text: `${p.to_be_packed} sales order(s) to be packed`, to: '/sales-orders?status=confirmed' },
    p.to_be_shipped > 0 && { text: `${p.to_be_shipped} package(s) to be shipped`, to: '/packages?status=not_shipped' },
    p.to_be_received > 0 && { text: `${p.to_be_received} purchase order(s) to be received`, to: '/purchase-orders?status=issued' },
    overdue && { text: 'Some customer invoices are overdue', to: '/invoices?status=overdue' },
    openTasks > 0 && { text: `${openTasks} open task(s) assigned to you`, to: '/tasks?status=open&assignee_id=me' },
  ].filter(Boolean);
  return (
    <Dropdown button={(toggle) => (
      <button type="button" className="icon-btn" onClick={() => { load(); toggle(); }} aria-label="Notifications">
        <Icon name="bell" />{items.length > 0 && <span className="dot" />}
      </button>
    )}>
      <div style={{ padding: '6px 14px', fontWeight: 600 }}>Notifications</div>
      <div className="sep" />
      {items.length === 0 && <div className="faint" style={{ padding: '8px 14px' }}>You're all caught up.</div>}
      {items.map((n) => <Link key={n.text} to={n.to}>{n.text}</Link>)}
    </Dropdown>
  );
}

function AnnouncementsBell() {
  const [inbox, setInbox] = useState({ data: [], unread: 0 });
  const [active, setActive] = useState(null);
  const load = () => api.get('/announcements/inbox').then(setInbox).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const openOne = async (a) => {
    setActive(a);
    if (!a.read) {
      await api.post(`/announcements/${a.id}/read`).catch(() => {});
      load();
    }
  };
  const markAll = async () => {
    await api.post('/announcements/read-all').catch(() => {});
    load();
  };
  return (
    <Dropdown button={(toggle) => (
      <button type="button" className="icon-btn" onClick={() => { load(); setActive(null); toggle(); }} aria-label="Announcements" title="Announcements">
        <Icon name="megaphone" />{inbox.unread > 0 && <span className="dot" />}
      </button>
    )}>
      <div className="row" style={{ padding: '6px 14px', gap: 8 }}>
        <strong style={{ flex: 1 }}>Announcements</strong>
        {inbox.unread > 0 && <button type="button" className="btn sm ghost" onClick={markAll}>Mark all read</button>}
      </div>
      <div className="sep" />
      {active ? (
        <div style={{ padding: '10px 14px', width: 320, maxWidth: '80vw' }}>
          <button type="button" className="btn sm ghost" onClick={() => setActive(null)}>← Back</button>
          <h3 style={{ margin: '10px 0 4px' }}>{active.title}</h3>
          <div className="small faint mb">{active.published_at ? new Date(active.published_at).toLocaleString('en-IN') : ''}</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}>{active.body || 'No details.'}</div>
        </div>
      ) : (
        <>
          {(!inbox.data || inbox.data.length === 0) && <div className="faint" style={{ padding: '8px 14px' }}>No announcements yet.</div>}
          {(inbox.data || []).map((a) => (
            <button type="button" key={a.id} onClick={() => openOne(a)} style={{ textAlign: 'left', width: '100%' }}>
              <div className="row" style={{ gap: 8 }}>
                {!a.read && <span className="dot" style={{ position: 'static', flexShrink: 0 }} />}
                <span className={a.read ? '' : 'bold'} style={{ flex: 1 }}>{a.title}</span>
                {a.pinned && <span className="badge">Pinned</span>}
              </div>
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export default function Layout({ children }: any) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [themePref, setThemePref] = useState(getTheme());
  const { organization } = useLookups('organization');
  useEffect(() => { applyBrandColor(organization?.brand_color); }, [organization?.brand_color]);
  const initials = (user?.name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <header className="topbar no-print">
          <GlobalSearch />
          <div className="spacer" />
          <Dropdown button={(toggle) => (
            <button type="button" className="icon-btn primary" onClick={toggle} aria-label="Quick create" title="Quick create"><Icon name="plus" /></button>
          )}>
            <div className="menu-cols">
              {QUICK_CREATE.map(([group, links]) => (
                <div key={group}>
                  <h4>{group}</h4>
                  {links.filter(([, , perm]) => can(perm, 'create')).map(([text, to]) => <Link key={to} to={to}>+ {text}</Link>)}
                </div>
              ))}
            </div>
          </Dropdown>
          <AnnouncementsBell />
          <Notifications />
          <Link className="icon-btn" to={`/help/${helpSlugFor(pathname)}`} title="Help for this page" aria-label="Help"><Icon name="help" /></Link>
          {can('settings') && <button type="button" className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings"><Icon name="settings" /></button>}
          <span className="org-name">{user?.org_name}</span>
          <Dropdown button={(toggle) => <button type="button" className="avatar" onClick={toggle} aria-label="Account">{initials}</button>}>
            <div style={{ padding: '6px 14px' }}>
              <div className="bold">{user?.name}</div>
              <div className="small faint">{user?.email}</div>
              <div className="small faint">{user?.role_name}</div>
            </div>
            <div className="sep" />
            <Link to="/profile">My profile</Link>
            <div className="sep" />
            <div className="small faint" style={{ padding: '2px 14px' }}>Appearance</div>
            {[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => (
              <button type="button" key={v} onClick={() => { setTheme(v); setThemePref(v); }}>{themePref === v ? '✓ ' : ' '}{l}</button>
            ))}
            <div className="sep" />
            <button type="button" className="danger" onClick={() => { logout(); navigate('/login'); }}>Sign out</button>
          </Dropdown>
        </header>
        <main className="content">{children}</main>
      </div>
      <ConfirmHost />
    </div>
  );
}
