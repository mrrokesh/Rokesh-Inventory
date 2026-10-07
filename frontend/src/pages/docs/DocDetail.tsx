import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, mediaUrl } from '../../api';
import { useAuth } from '../../auth';
import { useLookups } from '../../lib/lookups';
import { addressLines, date, label, modeLabel, money, qty, PAYMENT_TERMS } from '../../lib/format';
import { Badge, Dropdown, ErrorBox, PageHead, Spinner, confirmDialog, useAction, useApi } from '../../components/ui';
import { Attachments, History } from '../../components/Attachments';
import { useToast } from '../../components/Toast';
import Icon from '../../components/Icon';
import { ApplyCreditModal, PackageModal, ReceiveModal, RefundModal, ReturnModal } from './Modals';
import { CHALLAN_TYPES } from './config';
import { Comments, EmailModal } from '../../components/Comms';
import { CustomFieldValues } from '../../components/CustomFields';

const EMAILABLE = ['estimates', 'sales_orders', 'invoices', 'credit_notes', 'delivery_challans', 'purchase_orders', 'vendor_credits'];

export const TEMPLATE_DEFAULTS = {
  layout: 'standard', accent_color: '', title: '', show_logo: true, show_org_address: true, show_sku: true, show_hsn: true, show_discount: true,
  show_tax_column: true, show_unit: true, show_custom_fields: true, show_signature: true, signature_label: 'Authorised Signatory',
  header_note: '', footer_note: '', bank_details: '', default_notes: '', default_terms: '', font_size: 'normal',
};

// Links are plain text in template previews (sample data has no real records).
const DocLink = ({ to, preview, children }: any) => (preview ? <>{children}</> : <Link to={to}>{children}</Link>);

/** Printable document body (shared look for all priced documents). */
export function DocPaper({ cfg, doc, org, template = null, preview = false }: any) {
  const { templates } = useLookups('templates');
  const t = { ...TEMPLATE_DEFAULTS, ...(template || templates?.[cfg.entity] || {}) };
  const accent = t.accent_color || org?.brand_color || '';
  const terms = PAYMENT_TERMS.find((p) => p[0] === doc.payment_terms)?.[1];
  // GST: same state as the organization → CGST + SGST; another state → IGST.
  const gstMode = org?.gst_registered && org?.state;
  const inter = gstMode && doc.place_of_supply && doc.place_of_supply.toLowerCase() !== org.state.toLowerCase();
  const taxBreak = new Map();
  for (const l of doc.lines) {
    if (!l.tax_rate) continue;
    const tax = l.amount * (1 - doc.discount_percent / 100) * (l.tax_rate / 100);
    const r = Number(l.tax_rate);
    const parts = !gstMode ? [[`${l.tax_name || 'Tax'} (${r}%)`, tax]] : inter ? [[`IGST (${r}%)`, tax]] : [[`CGST (${r / 2}%)`, tax / 2], [`SGST (${r / 2}%)`, tax / 2]];
    for (const [k, v] of parts) taxBreak.set(k, (taxBreak.get(k) || 0) + v);
  }
  const showHsn = t.show_hsn && doc.lines.some((l) => l.hsn_sac);
  const showDisc = t.show_discount && doc.lines.some((l) => Number(l.discount_percent));
  const orgAddr = addressLines(org?.address);
  const style: any = { fontSize: { small: 12, normal: 14, large: 15.5 }[t.font_size] };
  if (accent) style['--doc-accent'] = accent;
  return (
    <div className={`doc-paper doc-${t.layout}${accent ? ' doc-accented' : ''}`} style={style}>
      {t.layout === 'modern' && <div className="doc-band" />}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div>
          {t.show_logo && org?.logo_path && <img src={mediaUrl(org.logo_path)} alt="" style={{ maxHeight: 60, maxWidth: 200, marginBottom: 8 }} />}
          <div className="bold" style={{ fontSize: '1.07em' }}>{org?.legal_name || org?.name}</div>
          {t.show_org_address && orgAddr.map((l) => <div key={l} className="small muted">{l}</div>)}
          {org?.gstin && <div className="small muted">GSTIN {org.gstin}</div>}
          {t.show_org_address && org?.email && <div className="small muted">{org.email}</div>}
        </div>
        <div className="spacer" />
        <div className="right">
          <div className="doc-title">{t.title || cfg.printTitle}</div>
          <div className="bold"># {doc.number}</div>
          {cfg.hasBalance && doc.status !== 'draft' && <div className="mt small muted">Balance due</div>}
          {cfg.hasBalance && doc.status !== 'draft' && <div className="bold" style={{ fontSize: 18 }}>{money(doc.balance)}</div>}
          {cfg.hasCredit && doc.status !== 'draft' && <><div className="mt small muted">Credits remaining</div><div className="bold" style={{ fontSize: 18 }}>{money(doc.balance)}</div></>}
        </div>
      </div>
      {t.header_note && <div className="doc-note mt" style={{ whiteSpace: 'pre-wrap' }}>{t.header_note}</div>}
      <div className="row mt" style={{ alignItems: 'flex-start', marginTop: t.layout === 'compact' ? 16 : 28 }}>
        <div style={{ flex: 1 }}>
          <div className="small muted">{cfg.contactType === 'customer' ? 'Bill to' : 'Vendor'}</div>
          <div className="bold"><DocLink preview={preview} to={`/${cfg.contactType}s/${doc.contact_id}`}>{doc.contact_name}</DocLink></div>
          {addressLines(doc.billing_address && Object.keys(doc.billing_address).length ? doc.billing_address : doc.contact_billing_address).map((l) => <div key={l} className="small">{l}</div>)}
        </div>
        {cfg.addresses && (
          <div style={{ flex: 1 }}>
            <div className="small muted">Ship to</div>
            {addressLines(doc.shipping_address && Object.keys(doc.shipping_address).length ? doc.shipping_address : doc.contact_shipping_address).map((l) => <div key={l} className="small">{l}</div>)}
          </div>
        )}
        <dl className="kv" style={{ gridTemplateColumns: '150px auto', flex: 1 }}>
          <dt>{cfg.dateLabel}</dt><dd>{date(doc.doc_date)}</dd>
          {doc.reference && <><dt>Reference#</dt><dd>{doc.reference}</dd></>}
          {doc.place_of_supply && <><dt>Place of supply</dt><dd>{doc.place_of_supply}</dd></>}
          {doc.contact_gstin && <><dt>Customer GSTIN</dt><dd className="mono">{doc.contact_gstin}</dd></>}
          {doc.expiry_date && <><dt>Valid until</dt><dd>{date(doc.expiry_date)}</dd></>}
          {doc.challan_type && <><dt>Challan type</dt><dd>{CHALLAN_TYPES.find((t) => t[0] === doc.challan_type)?.[1]}</dd></>}
          {doc.delivery_challan_number && <><dt>Delivery challan</dt><dd><DocLink preview={preview} to={`/delivery-challans/${doc.delivery_challan_id}`}>{doc.delivery_challan_number}</DocLink></dd></>}
          {doc.channel && doc.channel !== 'direct' && <><dt>Sales channel</dt><dd>{label(doc.channel)}</dd></>}
          {terms !== undefined && doc.payment_terms !== undefined && <><dt>Terms</dt><dd>{terms || `Net ${doc.payment_terms}`}</dd></>}
          {doc.due_date && <><dt>Due date</dt><dd>{date(doc.due_date)}</dd></>}
          {doc.expected_shipment_date && <><dt>Expected shipment</dt><dd>{date(doc.expected_shipment_date)}</dd></>}
          {doc.expected_delivery_date && <><dt>Expected delivery</dt><dd>{date(doc.expected_delivery_date)}</dd></>}
          {doc.delivery_method && <><dt>Delivery method</dt><dd>{doc.delivery_method}</dd></>}
          {doc.shipment_preference && <><dt>Shipment preference</dt><dd>{doc.shipment_preference}</dd></>}
          {doc.salesperson && <><dt>Salesperson</dt><dd>{doc.salesperson}</dd></>}
          {doc.sales_order_number && <><dt>Sales order</dt><dd><DocLink preview={preview} to={`/sales-orders/${doc.sales_order_id}`}>{doc.sales_order_number}</DocLink></dd></>}
          {doc.purchase_order_number && <><dt>Purchase order</dt><dd><DocLink preview={preview} to={`/purchase-orders/${doc.purchase_order_id}`}>{doc.purchase_order_number}</DocLink></dd></>}
          {doc.invoice_number && <><dt>Invoice</dt><dd><DocLink preview={preview} to={`/invoices/${doc.invoice_id}`}>{doc.invoice_number}</DocLink></dd></>}
          {doc.sales_return_number && <><dt>Sales return</dt><dd><DocLink preview={preview} to={`/sales-returns/${doc.sales_return_id}`}>{doc.sales_return_number}</DocLink></dd></>}
          {doc.bill_number && <><dt>Bill</dt><dd><DocLink preview={preview} to={`/bills/${doc.bill_id}`}>{doc.bill_number}</DocLink></dd></>}
          {doc.warehouse_name && <><dt>Warehouse</dt><dd>{doc.warehouse_name}</dd></>}
          {cfg.key === 'vendor_credits' && <><dt>Goods returned</dt><dd>{doc.return_stock ? 'Yes' : 'No'}</dd></>}
          {t.show_custom_fields && <CustomFieldValues entity={cfg.entity} values={doc.custom_fields} pdf />}
        </dl>
      </div>
      <table className="table mt" style={{ marginTop: 24 }}>
        <thead><tr><th>#</th><th>Item & description</th>{showHsn && <th>HSN/SAC</th>}
          {cfg.key === 'sales_orders' && <><th className="num">Packed</th><th className="num">Shipped</th><th className="num">Invoiced</th></>}
          {cfg.key === 'purchase_orders' && <><th className="num">Received</th><th className="num">Billed</th></>}
          <th className="num">Qty</th><th className="num">Rate</th>{showDisc && <th className="num">Discount</th>}{t.show_tax_column && <th className="num">Tax</th>}<th className="num">Amount</th></tr></thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>{l.item_id ? <DocLink preview={preview} to={`/items/${l.item_id}`}>{l.item_name}</DocLink> : null}{t.show_sku && l.item_sku && <span className="small faint"> · {l.item_sku}</span>}
                {l.description && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{l.description}</div>}
                {l.account && <div className="small faint">{l.account}</div>}
                {(l.units?.length > 0 || l.tracking) && <div className="small mono faint">{(l.units?.length ? l.units : (l.tracking?.serials || l.tracking?.batches?.map((b) => `${b.batch_no} × ${b.quantity}`) || [])).join(', ')}</div>}</td>
              {showHsn && <td className="small">{l.hsn_sac}</td>}
              {cfg.key === 'sales_orders' && <><td className="num">{qty(l.qty_packed)}</td><td className="num">{qty(l.qty_shipped)}</td><td className="num">{qty(l.qty_invoiced)}</td></>}
              {cfg.key === 'purchase_orders' && <><td className="num">{qty(l.qty_received)}</td><td className="num">{qty(l.qty_billed)}</td></>}
              <td className="num">{qty(l.quantity)} {t.show_unit ? l.item_unit || '' : ''}</td>
              <td className="num">{money(l.rate, { symbol: false })}</td>
              {showDisc && <td className="num">{Number(l.discount_percent) ? `${Number(l.discount_percent)}%` : '—'}</td>}
              {t.show_tax_column && <td className="num">{Number(l.tax_rate) ? `${Number(l.tax_rate)}%` : '—'}</td>}
              <td className="num">{money(l.amount, { symbol: false })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row mt" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          {doc.notes && <><div className="small muted">Notes</div><div style={{ whiteSpace: 'pre-wrap' }} className="mb">{doc.notes}</div></>}
          {doc.terms && <><div className="small muted">Terms & conditions</div><div style={{ whiteSpace: 'pre-wrap' }} className="mb">{doc.terms}</div></>}
          {t.bank_details && <><div className="small muted">Bank details</div><div style={{ whiteSpace: 'pre-wrap' }}>{t.bank_details}</div></>}
        </div>
        <div className="totals" style={{ background: 'none' }}>
          <div className="t-row"><span>Sub total</span><span>{money(doc.sub_total)}</span></div>
          {doc.discount_total > 0 && <div className="t-row"><span>Discount ({Number(doc.discount_percent)}%)</span><span>-{money(doc.discount_total)}</span></div>}
          {[...taxBreak.entries()].map(([k, v]) => <div className="t-row" key={k}><span>{k}</span><span>{money(v)}</span></div>)}
          {doc.shipping_charge > 0 && <div className="t-row"><span>Shipping charges</span><span>{money(doc.shipping_charge)}</span></div>}
          {doc.adjustment !== 0 && <div className="t-row"><span>Adjustment</span><span>{money(doc.adjustment)}</span></div>}
          <div className="t-row grand"><span>Total</span><span>{money(doc.total)}</span></div>
          {cfg.hasBalance && doc.amount_paid > 0 && <div className="t-row"><span>Payments made</span><span>(-) {money(doc.amount_paid)}</span></div>}
          {cfg.hasBalance && doc.credits_applied > 0 && <div className="t-row"><span>Credits applied</span><span>(-) {money(doc.credits_applied)}</span></div>}
          {cfg.hasBalance && doc.status !== 'draft' && <div className="t-row bold"><span>Balance due</span><span>{money(doc.balance)}</span></div>}
        </div>
      </div>
      {t.show_signature && (
        <div className="doc-sign">
          {org?.signature_path ? <img src={mediaUrl(org.signature_path)} alt="" /> : <div style={{ height: 48 }} />}
          <div className="doc-sign-line">{t.signature_label || 'Authorised Signatory'}</div>
          <div className="small faint">For {org?.legal_name || org?.name}</div>
        </div>
      )}
      {t.footer_note && <div className="doc-footer small muted" style={{ whiteSpace: 'pre-wrap' }}>{t.footer_note}</div>}
    </div>
  );
}

function Related({ title, rows, cols }: any) {
  if (!rows?.length) return null;
  return (
    <div className="card no-print">
      <div className="card-head"><h3>{title} ({rows.length})</h3></div>
      <table className="table compact"><tbody>
        {rows.map((r) => <tr key={r.id ?? r.number}>{cols.map((c, i) => <td key={i} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}</tr>)}
      </tbody></table>
    </div>
  );
}

export default function DocDetail({ cfg }: any) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const toast = useToast();
  const { organization: org } = useLookups('organization');
  const { data: doc, error, reload } = useApi(`${cfg.api}/${id}`);
  const [busy, run] = useAction(toast);
  const [modal, setModal] = useState(null);
  const [histKey, setHistKey] = useState(0);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!doc) return <div className="page"><Spinner /></div>;

  const refresh = () => { reload(); setHistKey((k) => k + 1); };
  const act = async (path: any, msg?: any, confirm?: any) => {
    if (confirm && !(await confirmDialog(confirm))) return;
    if (await run(() => api.post(`${cfg.api}/${doc.id}/${path}`), msg)) refresh();
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${cfg.one.toLowerCase()}`, message: `Delete ${doc.number}? This cannot be undone.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`${cfg.api}/${doc.id}`), `${cfg.one} deleted`)) !== undefined) navigate(cfg.path);
  };
  const delSub = async (path, msg) => {
    if (!(await confirmDialog({ message: 'Remove this entry?', danger: true, confirmText: 'Remove' }))) return;
    if ((await run(() => api.del(path), msg)) !== undefined) refresh();
  };
  const P = (a) => can(cfg.perm, a);
  const hasIntegration = (p) => (user?.integrations || []).includes(p);
  const s = doc.status;
  const isDraft = s === 'draft';

  // Primary workflow actions by document type and status.
  const actions = [];
  const more = [];
  if (isDraft && P('edit')) actions.push(<Link key="edit" className="btn" to={`${cfg.path}/${doc.id}/edit`}><Icon name="edit" size={14} className="" /> Edit</Link>);
  switch (cfg.key) {
    case 'estimates':
      if (isDraft && P('approve')) actions.push(<button key="s" type="button" className="btn primary" disabled={busy} onClick={() => act('send', 'Estimate marked as sent')}>Mark as sent</button>);
      if (['draft', 'sent', 'declined'].includes(s) && P('approve')) actions.push(<button key="a" type="button" className="btn" disabled={busy} onClick={() => act('accept', 'Marked as accepted')}>Mark accepted</button>);
      if (['sent', 'accepted'].includes(s) && P('approve')) more.push(<button key="d" type="button" onClick={() => act('decline', 'Marked as declined')}>Mark declined</button>);
      if (['draft', 'sent', 'accepted'].includes(s) && can('sales_orders', 'create')) {
        actions.push(<button key="c" type="button" className="btn primary" disabled={busy} onClick={async () => {
          const so = await run(() => api.post(`/estimates/${doc.id}/convert`), 'Sales order created from estimate');
          if (so) navigate(`/sales-orders/${so.id}`);
        }}>Convert to sales order</button>);
      }
      if (doc.sales_order_id) actions.push(<Link key="so" className="btn" to={`/sales-orders/${doc.sales_order_id}`}>View {doc.sales_order_number}</Link>);
      break;
    case 'delivery_challans':
      if (isDraft && P('approve')) actions.push(<button key="o" type="button" className="btn primary" disabled={busy} onClick={() => act('open', 'Challan opened — stock taken out')}>Open (dispatch goods)</button>);
      if (s === 'open' && P('edit')) actions.push(<button key="d" type="button" className="btn" disabled={busy} onClick={() => act('deliver', 'Marked as delivered')}>Mark delivered</button>);
      if (['open', 'delivered'].includes(s) && can('invoices', 'create')) actions.push(<Link key="i" className="btn primary" to={`/invoices/new?from_challan=${doc.id}`}>Convert to invoice</Link>);
      if (['open', 'delivered'].includes(s) && P('approve')) more.push(<button key="r" type="button" onClick={() => act('return', 'Goods returned to stock', { message: `Mark all goods on ${doc.number} as returned? They go back into stock.`, confirmText: 'Mark returned' })}>Mark goods returned</button>);
      if (doc.invoice_id) actions.push(<Link key="inv" className="btn" to={`/invoices/${doc.invoice_id}`}>View {doc.invoice_number}</Link>);
      break;
    case 'sales_orders':
      if (isDraft && P('approve')) actions.push(<button key="c" type="button" className="btn primary" disabled={busy} onClick={() => act('confirm', 'Sales order confirmed — stock committed')}>Confirm</button>);
      if (s === 'confirmed') {
        if (can('packages', 'create') && doc.package_status !== 'packed' && doc.package_status) actions.push(<button key="p" type="button" className="btn primary" onClick={() => setModal('package')}>Create package</button>);
        if (can('packages', 'create')) actions.push(<Link key="pl" className="btn" to={`/inventory/picklists/new?sales_order=${doc.id}`}>Create picklist</Link>);
        if (can('invoices', 'create') && doc.invoice_status !== 'invoiced') actions.push(<Link key="i" className="btn" to={`/invoices/new?from_so=${doc.id}`}>Create invoice</Link>);
        if (P('approve')) more.push(<button key="v" type="button" className="danger" onClick={() => act('void', 'Sales order voided', { message: `Void ${doc.number}? Committed stock will be released.`, danger: true, confirmText: 'Void' })}>Void</button>);
      }
      if (['confirmed', 'closed'].includes(s) && can('sales_returns', 'create') && doc.lines.some((l) => l.qty_shipped > l.qty_returned)) more.push(<button key="r" type="button" onClick={() => setModal('return')}>Create sales return</button>);
      break;
    case 'invoices':
      if (isDraft && P('approve')) actions.push(<button key="s" type="button" className="btn primary" disabled={busy} onClick={() => act('send', 'Invoice marked as sent')}>Mark as sent</button>);
      if (['sent', 'partially_paid'].includes(s) && can('payments_received', 'create')) actions.push(<Link key="pay" className="btn primary" to={`/payments-received/new?contact=${doc.contact_id}&invoice=${doc.id}`}>Record payment</Link>);
      if (['sent', 'partially_paid'].includes(s) && hasIntegration('razorpay') && P('edit')) {
        more.push(<button key="pl" type="button" onClick={async () => {
          const r = await run(() => api.post(`/integrations/razorpay/payment-link/${doc.id}`));
          if (r?.url) {
            try { await navigator.clipboard.writeText(r.url); toast('Online payment link copied — paste it into an email or WhatsApp message'); } catch { window.prompt('Payment link', r.url); }
            refresh();
          }
        }}>{doc.payment_link_url ? 'Copy online payment link' : 'Create online payment link'}</button>);
      }
      if (['sent', 'partially_paid', 'paid'].includes(s) && can('sales_returns', 'create')) more.push(<Link key="cn" to={`/credit-notes/new?from_invoice=${doc.id}`}>Create credit note</Link>);
      if (['sent', 'partially_paid', 'paid'].includes(s) && P('approve')) more.push(<button key="v" type="button" className="danger" onClick={() => act('void', 'Invoice voided', { message: `Void invoice ${doc.number}?${doc.sales_order_id ? '' : ' Stock removed by this invoice will be returned.'}`, danger: true, confirmText: 'Void' })}>Void</button>);
      break;
    case 'credit_notes':
      if (isDraft && P('edit')) actions.push(<button key="o" type="button" className="btn primary" disabled={busy} onClick={() => act('open', 'Credit note opened')}>Convert to open</button>);
      if (s === 'open' && P('edit')) {
        actions.push(<button key="a" type="button" className="btn primary" onClick={() => setModal('apply')}>Apply to invoices</button>);
        actions.push(<button key="r" type="button" className="btn" onClick={() => setModal('refund')}>Refund</button>);
      }
      if (['open', 'closed'].includes(s) && P('edit')) more.push(<button key="v" type="button" className="danger" onClick={() => act('void', 'Credit note voided', { message: `Void ${doc.number}?`, danger: true, confirmText: 'Void' })}>Void</button>);
      break;
    case 'purchase_orders':
      if (isDraft && P('approve')) actions.push(<button key="i" type="button" className="btn primary" disabled={busy} onClick={() => act('issue', 'Purchase order issued')}>Mark as issued</button>);
      if (s === 'issued') {
        if (can('purchase_receives', 'create') && doc.receive_status && doc.receive_status !== 'received') actions.push(<button key="r" type="button" className="btn primary" onClick={() => setModal('receive')}>Receive</button>);
        if (can('bills', 'create') && doc.bill_status !== 'billed') actions.push(<Link key="b" className="btn" to={`/bills/new?from_po=${doc.id}`}>Convert to bill</Link>);
        if (P('approve')) more.push(<button key="c" type="button" className="danger" onClick={() => act('cancel', 'Purchase order cancelled', { message: `Cancel ${doc.number}?`, danger: true, confirmText: 'Cancel order' })}>Cancel order</button>);
      }
      break;
    case 'bills':
      if (isDraft && P('approve')) actions.push(<button key="o" type="button" className="btn primary" disabled={busy} onClick={() => act('open', 'Bill opened')}>Convert to open</button>);
      if (['open', 'partially_paid'].includes(s) && can('payments_made', 'create')) actions.push(<Link key="pay" className="btn primary" to={`/payments-made/new?contact=${doc.contact_id}&bill=${doc.id}`}>Record payment</Link>);
      if (['open', 'partially_paid', 'paid'].includes(s) && can('vendor_credits', 'create')) more.push(<Link key="vc" to={`/vendor-credits/new?from_bill=${doc.id}`}>Create vendor credit</Link>);
      if (['open', 'partially_paid', 'paid'].includes(s) && P('approve')) more.push(<button key="v" type="button" className="danger" onClick={() => act('void', 'Bill voided', { message: `Void bill ${doc.number}?`, danger: true, confirmText: 'Void' })}>Void</button>);
      break;
    case 'vendor_credits':
      if (isDraft && P('edit')) actions.push(<button key="o" type="button" className="btn primary" disabled={busy} onClick={() => act('open', 'Vendor credit opened')}>Convert to open</button>);
      if (s === 'open' && P('edit')) actions.push(<button key="a" type="button" className="btn primary" onClick={() => setModal('apply')}>Apply to bills</button>);
      if (['open', 'closed'].includes(s) && P('edit')) more.push(<button key="v" type="button" className="danger" onClick={() => act('void', 'Vendor credit voided', { message: `Void ${doc.number}?`, danger: true, confirmText: 'Void' })}>Void</button>);
      break;
    default:
  }
  if (EMAILABLE.includes(cfg.key) && !isDraft) actions.push(<button key="email" type="button" className="btn" onClick={() => setModal('email')}>Email</button>);
  if (P('create')) more.push(<Link key="clone" to={`${cfg.path}/new?clone=${doc.id}`}>Clone</Link>);
  if (isDraft && P('delete')) more.push(<button key="del" type="button" className="danger" onClick={remove}>Delete</button>);

  const statusBadges = [<Badge key="s" status={doc.display_status || s} />];
  if (cfg.key === 'sales_orders' && !isDraft && s !== 'void') {
    if (doc.shipment_status) statusBadges.push(<Badge key="sh" status={doc.shipment_status} />);
    statusBadges.push(<Badge key="in" status={doc.invoice_status} />);
  }
  if (cfg.key === 'purchase_orders' && !isDraft && s !== 'cancelled') {
    if (doc.receive_status) statusBadges.push(<Badge key="rc" status={doc.receive_status} />);
    statusBadges.push(<Badge key="bl" status={doc.bill_status} />);
  }

  return (
    <div className="page">
      <PageHead title={`${cfg.one} ${doc.number}`} crumb={<Link to={cfg.path}>{cfg.title}</Link>}>
        {statusBadges}
        {actions}
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="print" size={14} className="" /> Print / PDF</button>
        {more.length > 0 && <Dropdown button={(t) => <button type="button" className="btn" onClick={t}>More ▾</button>}>{more}</Dropdown>}
      </PageHead>
      {isDraft && <div className="info-box mb no-print">This {cfg.one.toLowerCase()} is a draft. {cfg.key === 'sales_orders' ? 'Confirm it to commit stock and start fulfilment.' : cfg.key === 'purchase_orders' ? 'Issue it to start receiving goods.' : 'Open it to post it.'}</div>}
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <DocPaper cfg={cfg} doc={doc} org={org} />
        <div className="stack">
          <Related title="Packages" rows={doc.packages} cols={[
            { render: (r) => <Link to={`/packages/${r.id}`}>{r.number}</Link> }, { render: (r) => date(r.package_date) }, { render: (r) => <Badge status={r.status} /> }]} />
          <Related title="Shipments" rows={doc.shipments} cols={[
            { render: (r) => <Link to={`/shipments/${r.id}`}>{r.number}</Link> }, { render: (r) => [r.carrier, r.tracking_number].filter(Boolean).join(' · ') }, { render: (r) => <Badge status={r.status} /> }]} />
          <Related title="Invoices" rows={doc.invoices} cols={[
            { render: (r) => <Link to={`/invoices/${r.id}`}>{r.number}</Link> }, { render: (r) => <Badge status={r.status} /> }, { num: true, render: (r) => money(r.total) }]} />
          <Related title="Sales returns" rows={doc.sales_returns} cols={[
            { render: (r) => <Link to={`/sales-returns/${r.id}`}>{r.number}</Link> }, { render: (r) => date(r.return_date) }, { render: (r) => <Badge status={r.status} /> }]} />
          <Related title="Purchase receives" rows={doc.receives} cols={[
            { render: (r) => <Link to={`/purchase-receives/${r.id}`}>{r.number}</Link> }, { render: (r) => date(r.receive_date) }]} />
          <Related title="Bills" rows={doc.bills} cols={[
            { render: (r) => <Link to={`/bills/${r.id}`}>{r.number}</Link> }, { render: (r) => <Badge status={r.status} /> }, { num: true, render: (r) => money(r.total) }]} />
          <Related title="Payments" rows={doc.payments} cols={[
            { render: (r) => <Link to={`/payments-${cfg.key === 'bills' ? 'made' : 'received'}/${r.payment_id}`}>{r.number}</Link> },
            { render: (r) => `${date(r.payment_date)} · ${modeLabel(r.mode)}` }, { num: true, render: (r) => money(r.amount) }]} />
          <Related title="Credits applied" rows={doc.credits} cols={[
            { render: (r) => <Link to={cfg.key === 'bills' ? `/vendor-credits/${r.vendor_credit_id}` : `/credit-notes/${r.credit_note_id}`}>{r.number}</Link> },
            { render: (r) => date(r.applied_date) }, { num: true, render: (r) => money(r.amount) }]} />
          <Related title="Applied to" rows={doc.applications} cols={[
            { render: (r) => (r.invoice_number ? <Link to={`/invoices/${r.invoice_id}`}>{r.invoice_number}</Link> : <Link to={`/bills/${r.bill_id}`}>{r.bill_number}</Link>) },
            { num: true, render: (r) => money(r.amount) },
            { num: true, render: (r) => (P('edit') ? <button type="button" className="btn sm ghost danger" onClick={() => delSub(`${cfg.api}/${doc.id}/applications/${r.id}`, 'Credit application removed')}>Remove</button> : null) }]} />
          <Related title="Refunds" rows={doc.refunds} cols={[
            { render: (r) => `${date(r.refund_date)} · ${label(r.mode)}` }, { num: true, render: (r) => money(r.amount) },
            { num: true, render: (r) => (P('edit') ? <button type="button" className="btn sm ghost danger" onClick={() => delSub(`${cfg.api}/${doc.id}/refunds/${r.id}`, 'Refund removed')}>Remove</button> : null) }]} />
          {cfg.contactType === 'customer' || cfg.key === 'purchase_orders' ? <Comments entityType={cfg.entity} entityId={doc.id} portal={cfg.contactType === 'customer'} /> : null}
          <Attachments entityType={cfg.entity} entityId={doc.id} />
          <History entityType={cfg.entity} entityId={doc.id} reloadKey={histKey} />
        </div>
      </div>
      {modal === 'package' && <PackageModal so={doc} onClose={() => setModal(null)} onDone={(p) => { setModal(null); navigate(`/packages/${p.id}`); }} />}
      {modal === 'return' && <ReturnModal so={doc} onClose={() => setModal(null)} onDone={(r) => { setModal(null); navigate(`/sales-returns/${r.id}`); }} />}
      {modal === 'receive' && <ReceiveModal po={doc} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'apply' && <ApplyCreditModal credit={doc} kind={cfg.key === 'credit_notes' ? 'credit_note' : 'vendor_credit'} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'refund' && <RefundModal cn={doc} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'email' && <EmailModal entityType={cfg.entity} entityId={doc.id} onClose={() => setModal(null)} onSent={refresh} />}
    </div>
  );
}
