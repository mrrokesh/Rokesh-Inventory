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
      { label: 'Price Lists', to: '/price-lists', perm: 'items', feature: 'price_lists' },
    ],
  },
  {
    key: 'inventory', label: 'Inventory', icon: 'inventory', children: [
      { label: 'Inventory Adjustments', to: '/inventory/adjustments', perm: 'inventory' },
      { label: 'Stock Counts', to: '/inventory/stock-counts', perm: 'inventory', feature: 'stock_counts' },
      { label: 'Transfer Orders', to: '/inventory/transfers', perm: 'inventory', feature: 'locations' },
      { label: 'Assemblies', to: '/inventory/assemblies', perm: 'inventory' },
      { label: 'Picklists', to: '/inventory/picklists', perm: 'packages', feature: 'picklists' },
      { label: 'Packages', to: '/packages', perm: 'packages' },
      { label: 'Shipments', to: '/shipments', perm: 'packages' },
    ],
  },
  {
    key: 'sales', label: 'Sales', icon: 'sales', children: [
      { label: 'Customers', to: '/customers', perm: 'customers' },
      { label: 'Estimates', to: '/estimates', perm: 'estimates' },
      { label: 'Sales Orders', to: '/sales-orders', perm: 'sales_orders' },
      { label: 'Delivery Challans', to: '/delivery-challans', perm: 'delivery_challans', feature: 'delivery_challans' },
      { label: 'Invoices', to: '/invoices', perm: 'invoices' },
      { label: 'Retainer Invoices', to: '/retainers', perm: 'retainers', feature: 'retainer_invoices' },
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
  ['Sales', [['Customer', '/customers/new', 'customers'], ['Estimate', '/estimates/new', 'estimates'], ['Sales Order', '/sales-orders/new', 'sales_orders'], ['Delivery Challan', '/delivery-challans/new', 'delivery_challans', 'delivery_challans'], ['Invoice', '/invoices/new', 'invoices'], ['Retainer Invoice', '/retainers/new', 'retainers', 'retainer_invoices'], ['Payment Received', '/payments-received/new', 'payments_received'], ['Credit Note', '/credit-notes/new', 'sales_returns']]],
  ['Purchases', [['Vendor', '/vendors/new', 'vendors'], ['Purchase Order', '/purchase-orders/new', 'purchase_orders'], ['Bill', '/bills/new', 'bills'], ['Payment Made', '/payments-made/new', 'payments_made'], ['Vendor Credit', '/vendor-credits/new', 'vendor_credits']]],
];

const SEARCH_LINKS = {
  item: (id) => `/items/${id}`, customer: (id) => `/customers/${id}`, vendor: (id) => `/vendors/${id}`,
  sales_order: (id) => `/sales-orders/${id}`, invoice: (id) => `/invoices/${id}`, retainer: (id) => `/retainers/${id}`, purchase_order: (id) => `/purchase-orders/${id}`,
  bill: (id) => `/bills/${id}`, package: (id) => `/packages/${id}`, shipment: (id) => `/shipments/${id}`,
  credit_note: (id) => `/credit-notes/${id}`, vendor_credit: (id) => `/vendor-credits/${id}`,
  estimate: (id) => `/estimates/${id}`, delivery_challan: (id) => `/delivery-challans/${id}`, serial: (id) => `/items/${id}?tab=tracking`,
};

function Sidebar({ open: drawerOpen, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const { can, hasFeature } = useAuth();
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
  const go = () => onNavigate?.();

  return (
    <nav className={`sidebar no-print ${drawerOpen ? 'open' : ''}`} aria-label="Main">
      <Link to="/" className="brand" style={{ textDecoration: 'none' }} onClick={go}>
        <img className="brand-mark" src={LOGO_SRC} alt="" />
        <span className="brand-name">{APP_NAME}</span>
      </Link>
      {nav.map((g: any) => {
        if (g.children) {
          const children = g.children.filter((c) => (!c.perm || can(c.perm)) && (!c.feature || hasFeature(c.feature)));
          if (!children.length) return null;
          const active = children.some((c) => isActive(c.to));
          return (
            <div className="nav-group" key={g.key}>
              <button type="button" title={g.label} className={`nav-head ${open[g.key] ? 'open' : ''} ${active ? 'active' : ''}`} onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
                <Icon name={g.icon} /><span>{g.label}</span><Icon name="chevron" size={14} className="chev" />
              </button>
              {open[g.key] && children.map((c) => (
                <NavLink key={c.to} to={c.to} title={c.label} onClick={go} className={() => `nav-link sub ${isActive(c.to) ? 'active' : ''}`}>{c.label}</NavLink>
              ))}
            </div>
          );
        }
        if (g.perm && !can(g.perm)) return null;
        return (
          <NavLink key={g.key} to={g.to} title={g.label} onClick={go} className={() => `nav-link ${isActive(g.to) ? 'active' : ''}`}>
            <Icon name={g.icon} /><span>{g.label}</span>
          </NavLink>
        );
      })}
      <div style={{ flex: 1 }} />
      {can('settings') && (
        <NavLink to="/settings" title="Settings" onClick={go} className={() => `nav-link ${pathname.startsWith('/settings') ? 'active' : ''}`} style={{ marginBottom: 12 }}>
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
  const [tab, setTab] = useState('all');
  const [inbox, setInbox] = useState({ data: [], unread: 0 });
  const load = (which = tab) => api.get('/notifications', { tab: which, per_page: 30 }).then(setInbox).catch(() => {});
  useEffect(() => { load(); const t = setInterval(() => load(), 60000); return () => clearInterval(t); }, []);
  const markAll = async (e) => {
    e.stopPropagation();
    await api.post('/notifications/read-all').catch(() => {});
    load();
  };
  const openOne = async (n) => {
    if (!n.read_at) api.post(`/notifications/${n.id}/read`).catch(() => {});
  };
  const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '');
  const href = (n) => (n.link === '/configure-features' ? '/settings/features' : (n.link || '#'));
  return (
    <Dropdown menuClass="notify-menu" button={(toggle) => (
      <button type="button" className="icon-btn" onClick={() => { toggle(); load(); }} aria-label="Notifications">
        <Icon name="bell" />{inbox.unread > 0 && <span className="dot" />}
      </button>
    )}>
      <div className="notify-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notify-head">
          <h3>Notifications</h3>
          {inbox.unread > 0 && <button type="button" className="btn sm ghost" onClick={markAll}>Mark all read</button>}
        </div>
        <div className="notify-tabs" role="tablist">
          {[['all', 'All'], ['mentions', 'Mentions']].map(([k, l]) => (
            <button type="button" role="tab" key={k} aria-selected={tab === k}
              className={`notify-tab ${tab === k ? 'active' : ''}`}
              onClick={() => { setTab(k); load(k); }}>{l}</button>
          ))}
        </div>
        <div className="notify-list">
          {(!inbox.data || inbox.data.length === 0) && (
            <div className="notify-empty">
              <Icon name="bell" size={28} className="" />
              <div className="bold" style={{ marginTop: 8 }}>{tab === 'mentions' ? 'No mentions yet' : "You're all caught up"}</div>
              <p>{tab === 'mentions' ? 'When someone @mentions you in a comment, it shows up here.' : 'New alerts for your organization will appear here.'}</p>
            </div>
          )}
          {(inbox.data || []).map((n) => (
            <Link key={n.id} to={href(n)} onClick={() => openOne(n)} className={`notify-item ${n.read_at ? '' : 'unread'}`}>
              <span className={`notify-mark ${n.read_at ? 'read' : ''} ${n.kind === 'mention' ? 'mention' : ''}`} />
              <div className="notify-body">
                <div className={n.read_at ? '' : 'bold'}>{n.title}</div>
                {n.body && <div className="small faint notify-snippet">{n.body}</div>}
                <div className="small faint notify-time">{when(n.created_at)}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Dropdown>
  );
}

function MegaphoneMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M15.2 4.6v14.8c0 .8-.9 1.2-1.5.7L7.4 15.6H4.6A1.6 1.6 0 0 1 3 14v-4a1.6 1.6 0 0 1 1.6-1.6h2.8l6.3-4.5c.6-.5 1.5-.1 1.5.7z" />
      <path fill="currentColor" d="M7.8 15.5 6.5 19.4a1.15 1.15 0 0 0 1.1 1.5h1.5a1.15 1.15 0 0 0 1.1-.8l.8-2.6H8.6z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M18.2 8.6a4.4 4.4 0 0 1 0 6.8M20.6 6.5a7.4 7.4 0 0 1 0 11" />
    </svg>
  );
}

function AnnouncementsBell() {
  const [inbox, setInbox] = useState({ data: [], unread: 0 });
  const [active, setActive] = useState(null);
  const load = () => api.get('/announcements/inbox').then(setInbox).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const openOne = async (a, e) => {
    e?.stopPropagation();
    setActive(a);
    if (!a.read) {
      await api.post(`/announcements/${a.id}/read`).catch(() => {});
      load();
    }
  };
  const markAll = async (e) => {
    e.stopPropagation();
    await api.post('/announcements/read-all').catch(() => {});
    load();
  };
  return (
    <Dropdown menuClass="announce-menu" button={(toggle, open) => (
      <button type="button" className={`icon-btn announce-btn ${open ? 'open' : ''} ${inbox.unread > 0 ? 'has-unread' : ''}`}
        onClick={() => { load(); setActive(null); toggle(); }} aria-label="Announcements" title="Announcements">
        <MegaphoneMark />
        {inbox.unread > 0 && <span className="announce-count">{inbox.unread > 9 ? '9+' : inbox.unread}</span>}
      </button>
    )}>
      <div className="announce-panel" onClick={(e) => e.stopPropagation()}>
        <div className="announce-head">
          <MegaphoneMark size={20} />
          <h3>Announcements</h3>
          {inbox.unread > 0 && <button type="button" className="btn sm ghost" onClick={markAll}>Mark all read</button>}
        </div>
        {active ? (
          <div className="announce-detail">
            <button type="button" className="btn sm ghost" onClick={() => setActive(null)}>← Back</button>
            <h3>{active.title}</h3>
            <div className="small faint mb">{active.published_at ? new Date(active.published_at).toLocaleString('en-IN') : ''}</div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55 }}>{active.body || 'No details.'}</div>
          </div>
        ) : (!inbox.data || inbox.data.length === 0) ? (
          <div className="announce-empty">
            <div className="announce-art"><MegaphoneMark size={42} /></div>
            <div className="bold" style={{ color: 'var(--text)', marginBottom: 6 }}>You’re all caught up</div>
            <p>Company news, webinars and product updates from your team will show up here.</p>
          </div>
        ) : (
          <div className="announce-list">
            {(inbox.data || []).map((a) => (
              <button type="button" key={a.id} className={`announce-item ${a.read ? '' : 'unread'}`} onClick={(e) => openOne(a, e)}>
                <span className={`mark ${a.read ? 'read' : ''}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className={a.read ? '' : 'bold'} style={{ flex: 1 }}>{a.title}</span>
                    {a.pinned && <span className="badge">Pinned</span>}
                  </div>
                  {a.body && <div className="small faint" style={{ marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.body}</div>}
                  <div className="small faint" style={{ marginTop: 4 }}>{a.published_at ? new Date(a.published_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Dropdown>
  );
}

export default function Layout({ children }: any) {
  const { user, logout, can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [themePref, setThemePref] = useState(getTheme());
  const [navOpen, setNavOpen] = useState(false);
  const { organization } = useLookups('organization');
  useEffect(() => { applyBrandColor(organization?.brand_color); }, [organization?.brand_color]);
  useEffect(() => { setNavOpen(false); }, [pathname]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('nav-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('nav-open'); };
  }, [navOpen]);
  const initials = (user?.name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  const endImpersonation = () => {
    logout();
    navigate('/platform');
  };
  return (
    <div className={`app ${navOpen ? 'nav-drawer-open' : ''}`}>
      <button type="button" className="nav-backdrop no-print" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
      <div className="main">
        {user?.impersonating && (
          <div className="no-print impersonation-banner">
            <span>Support mode: viewing <strong>{user.org_name}</strong> as {user.email} (operator {user.impersonating.admin_email})</span>
            <button type="button" className="btn sm" style={{ background: '#fff', color: '#8a4c00' }} onClick={endImpersonation}>End session</button>
          </div>
        )}
        <header className="topbar no-print">
          <button type="button" className="icon-btn nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Open menu" aria-expanded={navOpen}>
            <Icon name="menu" />
          </button>
          <GlobalSearch />
          <div className="spacer" />
          <div className="topbar-actions">
            <Dropdown button={(toggle) => (
              <button type="button" className="icon-btn primary" onClick={toggle} aria-label="Quick create" title="Quick create"><Icon name="plus" /></button>
            )}>
              <div className="menu-cols">
                {QUICK_CREATE.map(([group, links]) => (
                  <div key={group}>
                    <h4>{group}</h4>
                    {links.filter(([, , perm, feature]) => can(perm, 'create') && (!feature || hasFeature(feature))).map(([text, to]) => <Link key={to} to={to}>+ {text}</Link>)}
                  </div>
                ))}
              </div>
            </Dropdown>
            <AnnouncementsBell />
            <Notifications />
            <Link className="icon-btn topbar-hide-sm" to={`/help/${helpSlugFor(pathname)}`} title="Help for this page" aria-label="Help"><Icon name="help" /></Link>
            {can('settings') && <button type="button" className="icon-btn topbar-hide-sm" onClick={() => navigate('/settings')} aria-label="Settings"><Icon name="settings" /></button>}
            <span className="org-name">{user?.org_name}</span>
            <Dropdown button={(toggle) => <button type="button" className="avatar" onClick={toggle} aria-label="Account">{initials}</button>}>
              <div style={{ padding: '6px 14px' }}>
                <div className="bold">{user?.name}</div>
                <div className="small faint">{user?.email}</div>
                <div className="small faint">{user?.role_name}</div>
              </div>
              <div className="sep" />
              <Link to="/profile">My profile</Link>
              <Link to="/help" className="topbar-menu-only-sm">Help & Guides</Link>
              {can('settings') && <Link to="/settings" className="topbar-menu-only-sm">Settings</Link>}
              <div className="sep" />
              <div className="small faint" style={{ padding: '2px 14px' }}>Appearance</div>
              {[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => (
                <button type="button" key={v} onClick={() => { setTheme(v); setThemePref(v); }}>{themePref === v ? '✓ ' : ' '}{l}</button>
              ))}
              <div className="sep" />
              <button type="button" className="danger" onClick={() => { logout(); navigate('/login'); }}>Sign out</button>
            </Dropdown>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      <ConfirmHost />
    </div>
  );
}
