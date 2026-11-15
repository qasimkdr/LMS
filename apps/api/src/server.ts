import { env } from './config/env';
import { createApp } from './app';
import { applyOverduePolicy } from './services/billing';

const app = createApp();
app.listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));

// Hourly: move schools with overdue subscription invoices to read-only / suspended.
setInterval(() => {
  applyOverduePolicy().catch((e) => console.error('overdue job failed', e));
}, 60 * 60 * 1000).unref();
