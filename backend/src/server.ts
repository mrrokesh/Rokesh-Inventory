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
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import itemRoutes from './routes/items.js';
import itemGroupRoutes from './routes/itemGroups.js';
import priceListRoutes from './routes/priceLists.js';
import { contactsRouter } from './routes/contacts.js';
import { adjustments, transfers, assemblies } from './routes/inventory.js';
import { stockCounts, picklists } from './routes/warehouseOps.js';
import taskRoutes from './routes/tasks.js';
import announcementRoutes from './routes/announcements.js';
import { salesOrders, packages, shipments, invoices, salesReturns, creditNotes } from './routes/sales.js';
import { purchaseOrders, purchaseReceives, bills, vendorCredits } from './routes/purchases.js';
import { paymentsRouter } from './routes/payments.js';
import documentRoutes from './routes/documents.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import { estimates, deliveryChallans } from './routes/salesDocs.js';
import emailRoutes from './routes/email.js';
import integrationRoutes from './routes/integrations.js';
import commentRoutes from './routes/comments.js';
import workflowRoutes from './routes/workflows.js';
import { startWorkflowWorkers } from './lib/workflows.js';
import portalRoutes, { portalAdmin } from './routes/portal.js';
import platformRoutes from './routes/platform.js';
import { handleRazorpayWebhook, startIntegrationScheduler } from './lib/integrations.js';
import { startWebhookWorker } from './lib/webhooks.js';
import { bootstrapPlatformAdmin } from './lib/bootstrapPlatform.js';

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
app.use(express.json({ limit: '5mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/uploads/public', express.static(publicDir, { maxAge: '7d', fallthrough: false }));

app.use('/api/auth', authRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/platform', platformRoutes);

const api = express.Router();
api.use(authenticate);
api.use('/settings', settingsRoutes);
api.use('/dashboard', dashboardRoutes);
api.use('/items', itemRoutes);
api.use('/item-groups', itemGroupRoutes);
api.use('/price-lists', priceListRoutes);
api.use('/customers', portalAdmin);
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
api.use('/payments-received', paymentsRouter('received'));
api.use('/sales-returns', salesReturns);
api.use('/credit-notes', creditNotes);
api.use('/purchase-orders', purchaseOrders);
api.use('/purchase-receives', purchaseReceives);
api.use('/bills', bills);
api.use('/payments-made', paymentsRouter('made'));
api.use('/vendor-credits', vendorCredits);
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
    startIntegrationScheduler();
  })
  .catch((err) => {
    console.error('Could not start:', err.message);
    process.exit(1);
  });
