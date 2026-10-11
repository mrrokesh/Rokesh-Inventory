import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFound } from './lib/errors.js';
import { publicDir } from './lib/upload.js';
import authRoutes from './routes/auth/auth.js';
import settingsRoutes from './routes/settings/settings.js';
import itemRoutes from './routes/catalog/items.js';
import itemGroupRoutes from './routes/catalog/itemGroups.js';
import priceListRoutes from './routes/catalog/priceLists.js';
import { contactsRouter } from './routes/catalog/contacts.js';
import { adjustments, transfers, assemblies } from './routes/inventory/inventory.js';
import { stockCounts, picklists } from './routes/inventory/warehouseOps.js';
import taskRoutes from './routes/inventory/tasks.js';
import announcementRoutes from './routes/settings/announcements.js';
import { salesOrders, packages, shipments, invoices, salesReturns, creditNotes } from './routes/sales/sales.js';
import { purchaseOrders, purchaseReceives, bills, vendorCredits } from './routes/purchases/purchases.js';
import { paymentsRouter } from './routes/purchases/payments.js';
import documentRoutes from './routes/documents/documents.js';
import dashboardRoutes from './routes/reports/dashboard.js';
import reportRoutes from './routes/reports/reports.js';
import { estimates, deliveryChallans, retainers } from './routes/sales/salesDocs.js';
import notificationRoutes from './routes/settings/notifications.js';
import { requireFeature } from './lib/orgFeatures.js';
import emailRoutes from './routes/settings/email.js';
import integrationRoutes from './routes/settings/integrations.js';
import commentRoutes from './routes/documents/comments.js';
import workflowRoutes from './routes/settings/workflows.js';
import landedCostRoutes from './routes/purchases/landedCosts.js';
import currencyRoutes from './routes/settings/currencies.js';
import { modulesRouter, recordsRouter, webTabsRouter, webFormsRouter } from './routes/modules/customModules.js';
import publicFormRoutes from './routes/modules/publicForms.js';
import { startWorkflowWorkers } from './lib/workflows.js';
import { startReportScheduler } from './routes/reports/reportSchedules.js';
import portalRoutes, { portalAdmin, vendorPortalAdmin } from './routes/platform/portal.js';
import platformRoutes from './routes/platform/platform.js';
import { handleRazorpayWebhook, startIntegrationScheduler } from './lib/integrations.js';
import { startWebhookWorker } from './lib/webhooks.js';
import { bootstrapPlatformAdmin } from './lib/bootstrapPlatform.js';
import { handlePlatformRazorpayWebhook, startBillingEnforcer } from './lib/saasBilling.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (config.corsOrigin.includes('*') || config.corsOrigin.includes(origin) || /\.vercel\.app$/i.test(origin)) {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  credentials: false,
}));
// Payment gateway webhooks need the raw body to verify signatures, so they come before the JSON parser.
app.post('/api/hooks/razorpay/:slug', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const r = await handleRazorpayWebhook(req.params.slug, req.body, req.get('x-razorpay-signature'));
    res.status(r.status).json({ ok: r.status === 200 });
  } catch (err) {
    console.error('Razorpay webhook error:', err.message);
    res.status(500).json({ ok: false });
  }
});
app.post('/api/hooks/platform-razorpay', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const r = await handlePlatformRazorpayWebhook(req.body, req.get('x-razorpay-signature'));
    res.status(r.status).json({ ok: r.status === 200, error: r.error });
  } catch (err) {
    console.error('Platform Razorpay webhook error:', err.message);
    res.status(500).json({ ok: false });
  }
});
app.use(express.json({ limit: '5mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/public/pricing', async (_req, res) => {
  const { query } = await import('./db.js');
  const { rows } = await query(
    `SELECT code, name, description, max_users, max_warehouses, max_items, modules, price_monthly
       FROM plans WHERE is_active ORDER BY sort_order, id`,
  );
  res.json({ data: rows, support_email: config.supportEmail, currency: 'INR' });
});
app.use('/uploads/public', express.static(publicDir, { maxAge: '7d', fallthrough: false }));

app.use('/api/auth', authRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/public', publicFormRoutes);
app.use('/api/platform', platformRoutes);

const api = express.Router();
api.use(authenticate);
api.use('/settings', settingsRoutes);
api.use('/dashboard', dashboardRoutes);
api.use('/items', itemRoutes);
api.use('/item-groups', itemGroupRoutes);
api.use('/price-lists', priceListRoutes);
api.use('/customers', portalAdmin);
api.use('/vendors', vendorPortalAdmin);
api.use('/customers', contactsRouter('customer'));
api.use('/vendors', contactsRouter('vendor'));
api.use('/inventory-adjustments', adjustments);
api.use('/transfer-orders', transfers);
api.use('/assemblies', assemblies);
api.use('/stock-counts', stockCounts);
api.use('/picklists', picklists);
api.use('/tasks', taskRoutes);
api.use('/announcements', announcementRoutes);
api.use('/estimates', estimates);
api.use('/sales-orders', salesOrders);
api.use('/delivery-challans', deliveryChallans);
api.use('/packages', packages);
api.use('/shipments', shipments);
api.use('/invoices', invoices);
api.use('/retainers', requireFeature('retainer_invoices'), retainers);
api.use('/notifications', notificationRoutes);
api.use('/payments-received', paymentsRouter('received'));
api.use('/sales-returns', salesReturns);
api.use('/credit-notes', creditNotes);
api.use('/purchase-orders', purchaseOrders);
api.use('/purchase-receives', purchaseReceives);
api.use('/bills', bills);
api.use('/payments-made', paymentsRouter('made'));
api.use('/vendor-credits', vendorCredits);
api.use('/landed-costs', landedCostRoutes);
api.use('/currencies', currencyRoutes);
api.use('/custom-modules', modulesRouter);
api.use('/m', recordsRouter);
api.use('/web-tabs', webTabsRouter);
api.use('/web-forms', webFormsRouter);
api.use('/documents', documentRoutes);
api.use('/reports', reportRoutes);
api.use('/email', emailRoutes);
api.use('/integrations', integrationRoutes);
api.use('/comments', commentRoutes);
api.use('/workflows', workflowRoutes);
app.use('/api', api);
app.use('/api', (_req, _res, next) => next(notFound('API endpoint')));

// In production, serve the built frontend (frontend/dist) from the same server.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

migrate()
  .then(() => bootstrapPlatformAdmin())
  .then(() => {
    app.listen(config.port, () => console.log(`Inventory API listening on http://localhost:${config.port}`));
    startWebhookWorker();
    startWorkflowWorkers();
    startReportScheduler();
    startIntegrationScheduler();
    startBillingEnforcer();
  })
  .catch((err) => {
    console.error('Could not start:', err.message);
    process.exit(1);
  });
