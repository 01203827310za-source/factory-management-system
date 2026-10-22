import { runAll } from './harness';
import './ledgers.test';
import './accounting.test';
import './receivables.test';
import './dashboard.test';
import './statusLabel.test';
import './guards.test';
import './allocation.test';
import './missingStock.test';
import './cancellation.test';
import './cashLedger.test';
import './monthlySales.test';

runAll();
