import { app } from 'electron';
import { IDENTITY } from './channel';

// Import before anything that reads app.getPath('userData'): core_config reads
// (and creates folders under) that path at module-load time, via index.ts's
// mainProcess -> database -> core_config chain. Setting the name first keeps a
// Beta build's library in its own "XeroTunes Beta" folder, not the release one.
app.setName(IDENTITY.productName);
app.setAppUserModelId(IDENTITY.appId);
